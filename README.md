# Video Evaluation

Anonymous frontend for a video comparison study. Participant answers are saved
by a separate response service and are never stored in this public repository.

The participant entry point is https://anonymous-video-quality-study.github.io/.
The Chinese questionnaire is https://anonymous-video-quality-study.github.io/cn/.
Both languages share the same videos, assignments, saved progress and response service.
Publish the `main` branch from `/(root)` using GitHub Pages. `.nojekyll` enables
static publishing.

Local previews default to group 1. The parameters `?preview=g1` through `?preview=g7`
allow review of all seven ten-example groups without submitting answers, including
at `/cn/?preview=g1`. All groups ask the same three questions. Groups 1–5 offer
four candidates; groups 6–7 offer A/B/About the same.
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

Videos are fully buffered before synchronized playback, and the next comparison
is prefetched while the current one plays. Only the current and next comparisons
are retained in memory. Retry preserves completed downloads, and slow downloads
remain active while bytes continue arriving. Media are unchanged. Transient
service requests retry once with the same session and answers; saved drafts
remain available after a connection failure.
