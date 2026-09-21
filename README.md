# Video Evaluation

Anonymous frontend for a video comparison study. Participant answers are saved
by a separate response service and are never stored in this public repository.

The participant entry point is https://anonymous-video-quality-study.github.io/.
Publish the `main` branch from `/(root)` using GitHub Pages. `.nojekyll` enables
static publishing.

Local previews default to group 1. The parameters `?preview=g1`, `?preview=g2`,
and `?preview=g3` allow review of all three groups without submitting answers.

All media are hosted in this repository. `study-config.json` contains the public
media decryption key, not a backend credential. Keep participant responses,
backend credentials, and method mappings outside this repository.
