import { Modal, SourceCard } from './bits';

export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to read this map" onClose={onClose} wide>
      <div className="about">
        <section>
          <h3>The Emotion view</h3>
          <p>
            The <strong>Emotion</strong> view estimates, every half second, how pleasant (valence) and how energetic (arousal) the music sounds to a typical listener, and names the
            emotion: joyful, tense, sad, calm and so on (Russell's circumplex). The estimate comes from the cues that carry emotion in music - loudness, note density, tempo and beat,
            major or minor harmony, clashing notes, brightness - plus a music mood tagger trained on listeners' tags (musicnn). The weights were fitted to real listeners'
            moment-by-moment ratings (VGMIDI) and checked on music the model never saw: it matched the average listener about as well as one listener matches the others.
          </p>
          <ul>
            <li>
              The brain is then lit by <strong>system</strong>: reward and pleasure (dopamine and opioids; gold), stress and tension (red), sadness (blue). These levels apply
              published brain-imaging and drug studies to the estimated emotion and to musical events such as build-ups and peaks. They are not measured, and they describe a
              typical listener.
            </li>
            <li>Dopamine release depends on enjoying the music, so the reward system follows your answer to "Do you like it?".</li>
            <li>Serotonin is not shown: no study has measured serotonin in the brain during music.</li>
            <li>For video, colour, motion, cuts and the expressions on faces add to the sound estimate; those picture rules were not checked against ratings.</li>
          </ul>
        </section>
        <section>
          <h3>The heat map</h3>
          <p>
            The <strong>Heat map</strong> view plays along with your media. At each moment the app measures what the media contains - loudness and punch, speech- and music-like
            sound, motion, faces, cuts and, with a transcript, words - and spreads that onto the brain areas that curated research links to each kind of input. Stronger and more
            direct research counts for more; findings that depend on the listener count for less; areas with no research link never heat up.
          </p>
          <ul>
            <li>
              It is an <strong>estimate</strong> for exploring media, not a recording or prediction of anyone's brain activity. Real brainwaves (EEG) or brain scans only come from
              sensors on a person.
            </li>
            <li>The "Brain systems over time" traces show the same estimate for groups of findings (hearing, voices, language, music and beat, vision, motion, faces, attention).</li>
            <li>It shows where the kinds of input are processed, not feelings or brain chemistry (see the Emotion view for those estimates).</li>
            <li>Tap any area and choose "Why?" to see the research behind it in the Evidence view.</li>
          </ul>
        </section>
        <section>
          <h3>The Evidence view: what this is - and is not</h3>
          <p>
            This is a <strong>research-based stimulus association map</strong>. It shows which brain regions and networks published studies associate with the <em>kinds</em> of stimuli
            detected in your media. It is <strong>not a brain scan</strong> and does not measure, predict or simulate anyone's neural activity.
          </p>
          <ul>
            <li>Colours are evidence categories (strong, moderate, limited, contested). They are not intensities, percentages or firing rates.</li>
            <li>Gray means "no verified association for this segment's features" - not "inactive". Every region is active all the time.</li>
            <li>In the Evidence view the map switches only when the segment changes; the timeline shows changing content features, not brain activity.</li>
            <li>This view infers no dopamine, hormones, emotions or activation levels; the Emotion view makes those estimates separately and labels them as estimates.</li>
          </ul>
        </section>
        <section>
          <h3>The three steps, kept separate</h3>
          <ol>
            <li>
              <strong>Detected in the media</strong> - measurable features (speech-like sound, a regular beat, a cut, a face) each with a <em>detection confidence</em>. Interpretations
              (humor, suspense, emotional theme) are labelled as such and need a person to confirm them.
            </li>
            <li>
              <strong>Candidate processes</strong> - a reviewed rule links each feature to a cognitive or sensory process and says whether applying research is a direct match, a partial
              match or an extrapolation that depends on the listener.
            </li>
            <li>
              <strong>Research associations</strong> - only curated evidence records can colour a region. Each record lists sources, their actual findings, a graded strength and
              limitations. If no record exists, the result is "insufficient evidence".
            </li>
          </ol>
          <p>Strong evidence for a general association is not strong evidence that this particular clip evokes that process.</p>
        </section>
        <section>
          <h3>Why responses vary</h3>
          <p>
            Brain responses depend on attention, familiarity, personal history, preferences, the task and context. The same story produced different responses in listeners given different
            interpretations, and familiar music engaged reward and limbic regions more than unfamiliar music. Regions are multifunctional and work in overlapping networks; locations also
            differ between individuals.
          </p>
          <SourceCard id="yeshurun2017" />
          <SourceCard id="pereira2011" />
          <SourceCard id="lindquist2012" />
        </section>
        <section>
          <h3>What fMRI does and does not measure</h3>
          <p>
            Most of the evidence comes from fMRI, which measures blood-oxygenation changes that follow neural activity with a delay of seconds. It is an indirect measure, not a recording of
            neurons firing. Inferring a mental process from activity in a region ("reverse inference") is only as good as the region's selectivity.
          </p>
          <SourceCard id="logothetis2008" />
          <SourceCard id="poldrack2006" />
        </section>
        <section>
          <h3>Neurosynth and NeuroQuery</h3>
          <p>
            These large-scale literature tools were considered as supplementary resources. Their maps summarise where papers that use a term report coordinates; extraction is automated and
            noisy, terms are words rather than validated mental states, and the maps are not validated predictions for arbitrary stimuli. They are therefore not used to colour the brain.
          </p>
          <SourceCard id="yarkoni2011" />
          <SourceCard id="neurosynth_faq" />
          <SourceCard id="dockes2020" />
        </section>
        <section>
          <h3>Anatomy</h3>
          <p>
            Region shapes come from the CerebrA atlas (Mindboggle-101 DKT labels corrected for the ICBM 2009c symmetric template; CC BY 4.0) via TemplateFlow. Networks come from the Schaefer
            2018 parcellation's 7-network assignment (Yeo et al. 2011; MIT licence), in the asymmetric version of the same template, so the network overlay is aligned only approximately.
            Functional areas such as the fusiform face area, MT+/V5, SMA and TPJ have no atlas label; when a finding concerns one, the whole containing gyrus is highlighted and marked
            "≈". No voxel-level hotspots are shown because the evidence is regional.
          </p>
          <SourceCard id="manera2020" />
          <SourceCard id="yeo2011" />
        </section>
        <section>
          <h3>Privacy and external services</h3>
          <ul>
            <li>All media analysis runs in your browser. Media is never uploaded or stored.</li>
            <li>
              Optional local speech recognition downloads the transformers.js library and ONNX runtime from cdn.jsdelivr.net and Whisper weights from huggingface.co. Audio is not sent;
              your browser may cache the model files.
            </li>
            <li>
              Optional interpretation suggestions send transcript text and segment times (never audio or video) to Anthropic's API with your own key, subject to Anthropic's API terms and
              data-retention policy. The key is kept in memory for that request only. Suggestions are never used for mapping until you confirm them, and the model never chooses brain
              regions.
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
