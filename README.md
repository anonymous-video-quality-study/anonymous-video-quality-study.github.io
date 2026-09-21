# Video Evaluation

Anonymous frontend for a video comparison study. Participant answers are saved
by a separate response service and are never stored in this public repository.

The participant entry point is https://anonymous-video-quality-study.github.io/.
Publish the `main` branch from `/(root)` using GitHub Pages. `.nojekyll` enables
static publishing.

Local previews default to group 1. The parameters `?preview=g1`, `?preview=g2`,
and `?preview=g3` allow review of all three groups without submitting answers.
Groups 1 and 2 contain 25 examples each; group 3 contains 20 examples.
All groups ask the same three questions, with A/B/About the same choices for group 3.
Existing participants retain the examples and questions from their assigned revision.

Participants can use Jump to browse their assigned examples. Unsaved choices
are kept as browser drafts across navigation and reloads. Saved answers can be
reviewed without being changed. Every example must be completed and saved in
order before the final submission can succeed.

Four-candidate studies are centered within a maximum width of 1600 pixels;
two-candidate studies retain their 1280-pixel cap. Desktop video
size is also limited by viewport height so both rows and playback controls
fit on short screens. Video aspect ratios, text and button sizes are preserved;
questions move below the videos at widths of 960 pixels or less.

All media are hosted in this repository. `study-config.json` contains the public
media decryption key, not a backend credential. Keep participant responses,
backend credentials, and method mappings outside this repository.
