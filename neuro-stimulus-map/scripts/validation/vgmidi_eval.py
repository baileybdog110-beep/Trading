#!/usr/bin/env python3
"""Check the emotion estimates against real listeners: VGMIDI (Ferreira & Whitehead 2019).

VGMIDI has continuous valence and arousal ratings for video-game piano pieces: about 30 people
per piece moved a valence/arousal cursor while listening, recorded once per bar (measure).
The rendered audio for about 100 of the pieces is in the same repository.

For every rated bar this script computes the same audio cues the app computes (loudness, note
density, tempo, brightness, noisiness, major/minor mode, dissonance) plus the musicnn listener-tag
probabilities, and compares several ways of turning them into valence and arousal with the mean
human rating:
  prior       fixed signs and rough weights from the music-emotion literature (not fitted)
  cues                    ridge regression on the cues, cross-validated with whole pieces held out
  cues+pieceContext       plus each cue relative to the song's own average
  tags                    ridge regression on the musicnn mood tags only
  cues+pieceContext+tags  everything (what the app uses when the tagger runs)
It also measures how well one listener agrees with the others, which is the natural ceiling.

Writes docs/validation/vgmidi.json (all numbers) and data/emotion/valence_arousal.json (the
coefficients the app uses, fitted on all rated bars, with their held-out accuracy).

Usage (numpy, scipy, scikit-learn, librosa, soundfile; tensorflow only to read the musicnn checkpoint):
  python scripts/validation/vgmidi_eval.py --data /some/cache/dir --checkpoint path/to/MSD_musicnn/
"""
import argparse
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'models'))
import emotion_features as F  # noqa: E402
from export_musicnn import MSD_LABELS  # noqa: E402

RAW = 'https://raw.githubusercontent.com/lucasnfe/vgmidi/master/labelled/'
KNOWN_PREFIX = {
    'Banjo-Kazooie': 'BanjoKazooie_',
    "Donkey Kong Country 2 Diddy's Kong Quest": 'Donkey_Kong_Country_2_',
    'Final Fantasy VII': 'Final_Fantasy_7_',
    'GoldenEye 007': 'Goldeneye_',
    "The Legend of Zelda Majora's Mask": 'Legend_Of_Zelda_The_Majoras_Mask_',
    'The Legend of Zelda Ocarina of Time': 'Legend_Of_Zelda_The_Ocarina_Of_Time_',
    'Shadow of the Colossus': 'Shadow_of_the_Colossus_',
    'Super Mario 64': 'Super_Mario_64_',
    'Super Mario Bros': 'Super_Mario_Bros_',
    'Super Mario World': 'Super_Mario_World_',
    'Tetris': 'Tetris_',
}
SHORT_WIN = 4.0   # s of audio before the end of each bar (the bar plus the lead-in listeners integrate over)
LONG_WIN = 8.0    # s for tempo and key, which need more context
SKIP_START = 5.0  # s: bars ending earlier are dropped while the cursor settles (as DEAM drops its first 15 s)
PATCH_HOP = 94    # musicnn patch hop in STFT frames (~1.5 s)

CUES = ['level', 'level_rel', 'level_var', 'onset_rate', 'flux', 'tempo', 'pulse', 'brightness', 'flatness', 'mode', 'key_clarity', 'dissonance']
# Direction and rough importance of each cue from the literature (Juslin & Laukka 2003 cue review; Gomez &
# Danuser 2007; Eerola, Friberg & Bresin 2013; Gabrielsson & Lindstrom 2010). 1 = primary cue, 0.5 = secondary,
# 0.25 = weak/inconsistent. Not fitted to any ratings.
PRIOR = {
    'arousal': {'level_rel': 1, 'onset_rate': 1, 'tempo': 0.5, 'flux': 0.5, 'brightness': 0.5, 'flatness': 0.25, 'level_var': 0.25},
    'valence': {'mode': 1, 'dissonance': -0.5, 'key_clarity': 0.25, 'tempo': 0.5, 'flatness': -0.25, 'brightness': 0.25},
}
# The absolute level depends on how loudly a file happens to be mastered, so the model uses loudness relative to
# the file itself instead (level_rel, level_var).
MODEL_CUES = [c for c in CUES if c != 'level']
# musicnn tags that describe mood or intensity (the others are genres and decades)
MODEL_TAGS = ['happy', 'sad', 'Mellow', 'chill', 'party', 'beautiful', 'easy listening', 'dance', 'metal', 'hard rock', 'punk', 'ambient']
Z_CLIP = 3.0


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def load_ratings(data):
    pieces = {}
    for fn in ('vgmidi_raw_1.json', 'vgmidi_raw_2.json'):
        d = json.load(open(os.path.join(data, fn)))
        for pid, p in d['pieces'].items():
            e = pieces.setdefault(p['midi'], {'midi': p['midi'], 'name': p['name'], 'duration': p['duration'], 'measures': p['measures'], 'val': [], 'aro': [], 'meta': []})
            if (e['duration'], e['measures']) != (p['duration'], p['measures']):
                print('inconsistent piece', p['midi'], file=sys.stderr)
        for aid, a in d['annotations'].items():
            p = d['pieces'].get(aid.rsplit('_', 1)[0])
            if p is None:  # a few ratings belong to pieces missing from the file
                continue
            e = pieces[p['midi']]
            if len(a['valence']) == e['measures'] == len(a['arousal']):
                e['val'].append(a['valence'])
                e['aro'].append(a['arousal'])
                e['meta'].append({k: a.get(k) for k in ('musicianship', 'isKnown')})
    return pieces


def match_audio(pieces, known):
    by_norm = {norm(w[:-4]): w for w in known}
    todo = []
    for e in pieces.values():
        series, console, game, track = e['midi'][:-4].split('_', 3)
        e['game'] = game
        pre = KNOWN_PREFIX.get(game)
        if pre and norm(pre + track) in by_norm:
            e['wav'] = by_norm[norm(pre + track)]
        else:
            words = re.sub(r"[^A-Za-z0-9 ]", '', game).split()
            track_c = re.sub(r'[^A-Za-z0-9]', '', track)
            guesses = [pre + track_c] if pre else ['_'.join(words) + '_' + track_c, ''.join(words) + '_' + track_c]
            todo.append((e, guesses))

    def probe(name):
        r = subprocess.run(['curl', '-s', '-o', '/dev/null', '-I', '-w', '%{http_code}', RAW + 'audio/' + name + '.wav'], capture_output=True, text=True)
        return r.stdout.strip() == '200'

    with cf.ThreadPoolExecutor(8) as ex:
        jobs = {ex.submit(probe, g): (e, g) for e, gs in todo for g in gs}
        for j in cf.as_completed(jobs):
            e, g = jobs[j]
            if j.result():
                e['wav'] = g + '.wav'
    return [e for e in pieces.values() if e.get('wav')]


def load_pcm(data, wav):
    import librosa
    os.makedirs(os.path.join(data, 'pcm'), exist_ok=True)
    npy = os.path.join(data, 'pcm', wav[:-4] + '.npy')
    if not os.path.exists(npy):
        tmp = os.path.join(data, 'pcm', 'dl.wav')
        subprocess.run(['curl', '-s', '--fail', '-o', tmp, RAW + 'audio/' + wav], check=True)
        y, _ = librosa.load(tmp, sr=F.SR, mono=True)
        np.save(npy, (np.clip(y, -1, 1) * 32767).astype(np.int16))
        os.remove(tmp)
    return np.load(npy).astype(np.float64) / 32767


def piece_features(y, mel_fb, W, forward):
    """Per-piece frame series; windows are cut from these per bar."""
    db, flux, flat = F.frame_features(y)
    logmel, centroid, tot = F.stft_features(y, mel_fb)
    C = F.chroma(y)
    tags = []
    if W is not None:
        for s in range(0, max(1, logmel.shape[0] - 187 + 1), PATCH_HOP):
            patch = logmel[s:s + 187]
            if patch.shape[0] < 187:
                patch = np.pad(patch, ((0, 187 - patch.shape[0]), (0, 0)))
            tags.append(((s + 93.5) * 256 / F.SR, forward(W, patch.astype(np.float32))))
    return {'db': db, 'flux': flux, 'flat': flat, 'centroid': centroid, 'tot': tot, 'chroma': C, 'diss': F.dissonance(C), 'tags': tags}


def window_cues(P, t_end, piece_ref):
    fa, fb = max(0, int((t_end - SHORT_WIN) * F.FPS)), max(1, int(t_end * F.FPS))
    la = max(0, int((t_end - LONG_WIN) * F.FPS))
    db = P['db'][fa:fb]
    aud = db[db > F.SILENCE_DB]
    level = 10 * np.log10(np.mean(10 ** (aud / 10))) if len(aud) else -60.0
    bpm, clarity = F.beat_strength(P['flux'], la, fb)
    sa, sb = max(0, int((t_end - SHORT_WIN) * F.SR / 256)), max(1, int(t_end * F.SR / 256))
    tot = P['tot'][sa:sb]
    cen = P['centroid'][sa:sb]
    bright = np.log2(max(50.0, (cen * tot).sum() / tot.sum()) / 1000) if tot.sum() > 1e-10 else 0.0
    ca, cb = max(0, int((t_end - LONG_WIN) * F.SR / 2048)), max(1, int(t_end * F.SR / 2048))
    mode, clar, _, _ = F.key_mode(P['chroma'][ca:cb].sum(axis=0))
    da, dbb = max(0, int((t_end - SHORT_WIN) * F.SR / 2048)), max(1, int(t_end * F.SR / 2048))
    return {
        'level': level,
        'level_rel': level - piece_ref,
        'level_var': float(np.std(aud)) if len(aud) > 1 else 0.0,
        'onset_rate': F.onset_rate(P['flux'], fa, fb),
        'flux': float(P['flux'][fa:fb].mean()),
        'tempo': np.log2(bpm / 100) if bpm > 0 and clarity > 0.05 else 0.0,
        'pulse': clarity,
        'brightness': bright,
        'flatness': float(P['flat'][fa:fb].mean()),
        'mode': mode,
        'key_clarity': clar,
        'dissonance': float(P['diss'][da:dbb].mean()),
    }


def window_tags(P, t_end):
    if not P['tags']:
        return None
    centers = np.array([c for c, _ in P['tags']])
    sel = np.where((centers >= t_end - SHORT_WIN) & (centers <= t_end))[0]
    if not len(sel):
        sel = [int(np.argmin(np.abs(centers - (t_end - SHORT_WIN / 2))))]
    return np.mean([P['tags'][i][1] for i in sel], axis=0)


# ---------------------------------------------------------------------------------------------- stats

def pearson(a, b):
    a = np.asarray(a, float) - np.mean(a)
    b = np.asarray(b, float) - np.mean(b)
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def summarize(y, p, groups):
    """Bar-level r and R^2, piece-level r (piece means), within-piece r (does it follow changes over time)."""
    y, p, groups = np.asarray(y), np.asarray(p), np.asarray(groups)
    ug = np.unique(groups)
    ym = np.array([y[groups == g].mean() for g in ug])
    pm = np.array([p[groups == g].mean() for g in ug])
    within = []
    for g in ug:
        m = groups == g
        if m.sum() >= 6 and y[m].std() > 0.05:
            within.append(pearson(y[m], p[m]))
    sign = float(np.mean(np.sign(ym) == np.sign(pm)))
    return {'r': round(pearson(y, p), 3), 'r2': round(1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum(), 3),
            'pieceR': round(pearson(ym, pm), 3), 'withinR_median': round(float(np.median(within)), 3) if within else None,
            'withinR_n': len(within), 'pieceSignAgreement': round(sign, 3)}


def human_agreement(rows, dim):
    """One listener against the mean of the other listeners of the same piece (bar level, pooled; piece
    level; within-piece), and split-half reliability of the crowd mean (Spearman-Brown)."""
    rng = np.random.default_rng(0)
    ys, ps, gs, within, halves = [], [], [], [], []
    for gi, (A, keep) in enumerate(rows):
        A = A[:, keep]
        k = A.shape[0]
        if k < 4:
            continue
        for j in range(k):
            others = np.delete(A, j, axis=0).mean(axis=0)
            ys.append(others)
            ps.append(A[j])
            gs.append(np.full(A.shape[1], gi * 1000 + j))
            if A.shape[1] >= 6 and others.std() > 0.05 and A[j].std() > 0:
                within.append(pearson(others, A[j]))
    ys, ps, gs = np.concatenate(ys), np.concatenate(ps), np.concatenate(gs)
    for _ in range(20):
        h1, h2 = [], []
        for A, keep in rows:
            A = A[:, keep]
            idx = rng.permutation(A.shape[0])
            h = A.shape[0] // 2
            h1.append(A[idx[:h]].mean(axis=0))
            h2.append(A[idx[h:2 * h]].mean(axis=0))
        r = pearson(np.concatenate(h1), np.concatenate(h2))
        halves.append(2 * r / (1 + r))
    pooled = pearson(ys, ps)
    # piece level: each listener's mean for a piece vs the others' mean
    pm = [(ps[gs == g].mean(), ys[gs == g].mean()) for g in np.unique(gs)]
    return {'oneListenerVsOthers_r': round(pooled, 3), 'oneListenerVsOthers_pieceR': round(pearson(*zip(*pm)), 3),
            'oneListenerVsOthers_withinR_median': round(float(np.median(within)), 3), 'crowdMeanReliability': round(float(np.mean(halves)), 3)}


def cv_predict(X, y, groups, n_splits=5, alphas=(0.1, 1, 10, 100, 1000)):
    from sklearn.linear_model import Ridge
    from sklearn.model_selection import GridSearchCV, GroupKFold
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    pred = np.zeros_like(y)
    for tr, te in GroupKFold(n_splits).split(X, y, groups):
        m = GridSearchCV(make_pipeline(StandardScaler(), Ridge()), {'ridge__alpha': alphas}, cv=GroupKFold(4), scoring='r2')
        m.fit(X[tr], y[tr], groups=groups[tr])
        pred[te] = m.predict(X[te])
    return pred


def prior_predict(X, y, groups, names, weights, n_splits=5):
    """Literature-prior score, then a 2-parameter rescaling fitted on the training folds (for R^2 only)."""
    from sklearn.model_selection import GroupKFold
    pred = np.zeros_like(y)
    w = np.array([weights.get(n, 0) for n in names], float)
    for tr, te in GroupKFold(n_splits).split(X, y, groups):
        mu, sd = X[tr].mean(axis=0), X[tr].std(axis=0) + 1e-9
        s_tr = ((X[tr] - mu) / sd) @ w / np.abs(w).sum()
        s_te = ((X[te] - mu) / sd) @ w / np.abs(w).sum()
        a, b = np.polyfit(s_tr, y[tr], 1)
        pred[te] = a * s_te + b
    return pred


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, help='cache dir holding vgmidi_raw_1.json, vgmidi_raw_2.json and audio_list.txt')
    ap.add_argument('--checkpoint', help='musicnn MSD_musicnn checkpoint dir (tags are skipped without it)')
    ap.add_argument('--recompute-cues', action='store_true', help='recompute the cues of cached pieces (keeps cached tags)')
    args = ap.parse_args()
    import librosa

    pieces = load_ratings(args.data)
    known = [l.strip() for l in open(os.path.join(args.data, 'audio_list.txt')) if l.strip().endswith('.wav')]
    matched = sorted(match_audio(pieces, known), key=lambda e: e['wav'])
    print(f'{len(pieces)} rated pieces, {len(matched)} with audio', flush=True)

    W = forward = None
    if args.checkpoint:
        import export_musicnn as E
        R = E.reader(args.checkpoint)
        W = {k: R.get_tensor(k).astype(np.float32) for k in E.ORDER}
        forward = E.forward
    mel_fb = librosa.filters.mel(sr=F.SR, n_fft=512, n_mels=96)

    rows = {'cues': [], 'tags': [], 'val': [], 'aro': [], 'group': [], 'game': [], 't': []}
    human = {'val': [], 'aro': []}
    per_piece = []
    os.makedirs(os.path.join(args.data, 'feat'), exist_ok=True)
    for i, e in enumerate(matched):
        cache = os.path.join(args.data, 'feat', e['wav'][:-4] + '.json')
        if os.path.exists(cache) and args.recompute_cues:
            # keep the (slow) cached musicnn tags, recompute the cues
            rec = json.load(open(cache))
            y = load_pcm(args.data, e['wav'])
            P = piece_features(y, mel_fb, None, None)
            aud = P['db'][P['db'] > F.SILENCE_DB]
            ref = float(np.percentile(aud, 95)) if len(aud) else -20.0
            for b in rec['bars']:
                b['cues'] = window_cues(P, b['t'], ref)
            json.dump(rec, open(cache, 'w'))
        elif os.path.exists(cache):
            rec = json.load(open(cache))
        else:
            y = load_pcm(args.data, e['wav'])
            P = piece_features(y, mel_fb, W, forward)
            aud = P['db'][P['db'] > F.SILENCE_DB]
            ref = float(np.percentile(aud, 95)) if len(aud) else -20.0
            L = e['duration'] / e['measures']
            rec = {'audioSeconds': len(y) / F.SR, 'bars': []}
            for m in range(e['measures']):
                t_end = min((m + 1) * L, len(y) / F.SR)
                tg = window_tags(P, t_end)
                rec['bars'].append({'t': t_end, 'cues': window_cues(P, t_end, ref), 'tags': None if tg is None else [float(v) for v in tg]})
            json.dump(rec, open(cache, 'w'))
        V, A = np.array(e['val'], float), np.array(e['aro'], float)
        keep = np.array([b['t'] >= SKIP_START for b in rec['bars']])
        if abs(rec['audioSeconds'] - e['duration']) > 3 or keep.sum() < 3 or len(V) < 4:
            print('skip', e['wav'], rec['audioSeconds'], e['duration'], len(V))
            continue
        human['val'].append((V, keep))
        human['aro'].append((A, keep))
        per_piece.append({'wav': e['wav'], 'game': e['game'], 'raters': len(V), 'bars': int(keep.sum()),
                          'valence': round(float(V[:, keep].mean()), 3), 'arousal': round(float(A[:, keep].mean()), 3)})
        for m, b in enumerate(rec['bars']):
            if not keep[m]:
                continue
            rows['cues'].append([b['cues'][c] for c in CUES])
            rows['tags'].append(b['tags'])
            rows['val'].append(V[:, m].mean())
            rows['aro'].append(A[:, m].mean())
            rows['group'].append(i)
            rows['game'].append(e['game'])
            rows['t'].append(b['t'])
        print(f'[{i + 1}/{len(matched)}] {e["wav"]} raters={len(V)} bars={keep.sum()}', flush=True)

    Xall = np.array(rows['cues'], float)
    Xc = Xall[:, [CUES.index(c) for c in MODEL_CUES]]
    groups = np.array(rows['group'])
    games = np.array(rows['game'])
    game_ids = np.unique(games, return_inverse=True)[1]
    Y = {'valence': np.array(rows['val']), 'arousal': np.array(rows['aro'])}
    has_tags = rows['tags'][0] is not None
    Xt = None
    if has_tags:
        T = np.clip(np.array(rows['tags'], float), 1e-6, 1 - 1e-6)
        Xt = np.log(T / (1 - T))[:, [MSD_LABELS.index(t) for t in MODEL_TAGS]]
    Dc = piece_deviation(Xc, groups)

    out = {
        'dataset': 'VGMIDI (Ferreira & Whitehead 2019): continuous valence/arousal per bar, video-game piano pieces rendered to audio',
        'pieces': len(per_piece), 'bars': int(len(groups)), 'raters': int(sum(p['raters'] for p in per_piece)),
        'targetSD': {d: round(float(Y[d].std()), 3) for d in Y},
        'settings': {'shortWindowS': SHORT_WIN, 'longWindowS': LONG_WIN, 'skipStartS': SKIP_START,
                     'cv': '5-fold, whole pieces held out (GroupKFold); ridge alpha chosen by inner 4-fold group CV; standardisation fitted on training folds'},
        'human': {'valence': human_agreement(human['val'], 'valence'), 'arousal': human_agreement(human['aro'], 'arousal')},
        'models': {}, 'byGameHeldOut': {}, 'perPiece': per_piece,
    }
    variants = {
        'prior': None,
        'cues': Xc,
        'cues+pieceContext': np.hstack([Xc, Dc]),
    }
    if has_tags:
        variants['tags'] = Xt
        variants['cues+tags'] = np.hstack([Xc, Xt])
        variants['cues+pieceContext+tags'] = np.hstack([Xc, Dc, Xt, piece_deviation(Xt, groups)])
    for dim in ('valence', 'arousal'):
        y = Y[dim]
        out['models'][dim] = {name: summarize(y, prior_predict(Xc, y, groups, MODEL_CUES, PRIOR[dim]) if X is None else cv_predict(X, y, groups), groups)
                              for name, X in variants.items()}
        # stricter: hold out whole games (different composers, arrangers and sound)
        out['byGameHeldOut'][dim] = {name: summarize(y, cv_predict(variants[name], y, game_ids), groups)
                                     for name in ('cues+pieceContext', 'cues+pieceContext+tags') if name in variants}
        out.setdefault('cueCorrelations', {})[dim] = {c: round(pearson(Xall[:, k], y), 3) for k, c in enumerate(CUES)}
        if has_tags:
            out.setdefault('tagCorrelations', {})[dim] = {t: round(pearson(Xt[:, k], y), 3) for k, t in enumerate(MODEL_TAGS)}

    os.makedirs(os.path.join(ROOT, 'docs', 'validation'), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, 'docs', 'validation', 'vgmidi.json'), 'w'), indent=1)
    export_model(out, Xc, Dc, Xt, Y, groups)
    print(json.dumps({k: out[k] for k in ('pieces', 'bars', 'raters', 'targetSD', 'human', 'models', 'byGameHeldOut')}, indent=1))


def piece_deviation(X, groups):
    """Each bar's features minus the mean of its piece: lets the model weigh changes within a song
    separately from the song's overall character (both are available when the whole file is analysed)."""
    D = X.copy()
    for g in np.unique(groups):
        m = groups == g
        D[m] = X[m] - X[m].mean(axis=0)
    return D


def fit_block(X, y, groups):
    from sklearn.linear_model import Ridge
    from sklearn.model_selection import GridSearchCV, GroupKFold
    mu, sd = X.mean(axis=0), X.std(axis=0) + 1e-9
    Z = np.clip((X - mu) / sd, -Z_CLIP, Z_CLIP)
    m = GridSearchCV(Ridge(), {'alpha': [0.1, 1, 10, 100, 1000]}, cv=GroupKFold(5), scoring='r2').fit(Z, y, groups=groups)
    return mu, sd, m.best_estimator_.coef_, float(m.best_estimator_.intercept_), m.best_params_['alpha']


def export_model(out, Xc, Dc, Xt, Y, groups):
    """Coefficients the app uses (src/emotion/model.ts), fitted on every rated bar."""
    r3 = lambda a: [round(float(v), 6) for v in a]
    models = {}
    for name, blocks in (('cues', [('cues', Xc), ('cueChanges', Dc)]),
                         ('cues+tags', [('cues', Xc), ('cueChanges', Dc), ('tags', Xt), ('tagChanges', None if Xt is None else piece_deviation(Xt, groups))])):
        if any(b is None for _, b in blocks):
            continue
        X = np.hstack([b for _, b in blocks])
        key = 'cues+pieceContext' + ('+tags' if 'tags' in name else '')
        m = {'inputs': [], 'zClip': Z_CLIP}
        for dim in ('valence', 'arousal'):
            mu, sd, coef, b0, alpha = fit_block(X, Y[dim], groups)
            m[dim] = {'intercept': round(b0, 6), 'alpha': alpha, 'mean': r3(mu), 'sd': r3(sd), 'coef': r3(coef),
                      'heldOut': out['models'][dim][key], 'heldOutByGame': out['byGameHeldOut'][dim][key]}
        for label, blk in blocks:
            names = MODEL_TAGS if label.startswith('tag') else MODEL_CUES
            m['inputs'] += [{'block': label, 'name': n} for n in names]
        models[name] = m
    doc = {
        'note': 'Generated by scripts/validation/vgmidi_eval.py. Ridge regression on standardised inputs (z clipped to +-zClip), '
                'fitted to the mean valence and arousal ratings (-1..1) of VGMIDI listeners per bar. heldOut = accuracy on pieces the '
                'fit never saw (5-fold, pieces held out); heldOutByGame = whole games held out.',
        'source': 'ferreira2019',
        'windows': {'shortS': SHORT_WIN, 'longS': LONG_WIN},
        'human': out['human'],
        'targetSD': out['targetSD'],
        'models': models,
    }
    os.makedirs(os.path.join(ROOT, 'data', 'emotion'), exist_ok=True)
    json.dump(doc, open(os.path.join(ROOT, 'data', 'emotion', 'valence_arousal.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
