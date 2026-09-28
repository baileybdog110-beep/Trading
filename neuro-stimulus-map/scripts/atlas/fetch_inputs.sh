#!/usr/bin/env sh
# Download the atlas volumes used by build_atlas.py from TemplateFlow.
set -eu
OUT="${1:-atlas_inputs}"
mkdir -p "$OUT"
B=https://templateflow.s3.amazonaws.com
for f in \
  tpl-MNI152NLin2009cSym/tpl-MNI152NLin2009cSym_res-1_atlas-CerebrA_dseg.nii.gz \
  tpl-MNI152NLin2009cSym/tpl-MNI152NLin2009cSym_atlas-CerebA_dseg.tsv \
  tpl-MNI152NLin2009cSym/LICENSE \
  tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_atlas-Schaefer2018_desc-400Parcels7Networks_dseg.nii.gz \
  tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_atlas-Schaefer2018_desc-400Parcels7Networks_dseg.tsv; do
  curl -fsSL "$B/$f" -o "$OUT/$(basename "$f")"
done
echo "Downloaded to $OUT"
