# Focus Studio

**Open the study app: https://tateereynolds.github.io/Big-Cloud/**

The website runs directly in your browser. You do not need Python, VS Code, or a terminal to use it.

## Start studying

1. Open the link above, preferably in Chrome or Edge.
2. Enter your subject and a small goal.
3. Optionally enable your camera and allow the camera prompt. Capture your screen viewing position, then your paper-notes position.
4. Start a study block. If camera estimates do not fit your work, choose **Manual: studying** or **Manual: distracted**.

Defaults: a 50-minute study block, 15-minute short break, and a 30-minute long break after four completed study blocks. In **Customize**, you can choose a 60-minute long break and adjust other durations. Pauses and breaks do not count as study time. Each new block waits for your click. Finishing early saves your time without advancing the break cycle.

## Your data

The journal, settings, and calibration are saved in **this browser on this device**. They are not uploaded to GitHub and do not automatically sync to another browser or device. Use **Export** to download your study history as CSV. Clearing browser data can erase saved progress. Private browsing or a full/blocked storage area can prevent saves; the app shows a warning and still lets you export the visible journal.

Refreshing restores a paused timer from its latest checkpoint. Closed-browser time is excluded. Sleeping/throttled intervals are marked unobserved and capped at the end of the study block. The journal displays up to 100 selected sessions; task summaries include all saved sessions in the chosen range.

## Camera estimates

Camera images are processed in your browser and are never recorded or uploaded. No microphone is requested. MediaPipe estimates iris position and head direction relative to your calibrated screen and notes views. A TensorFlow.js COCO-SSD model estimates visible phones. Its libraries/model files download from jsDelivr and Google when enabled.

These are attention estimates, not a measure of learning. Lighting, glasses, camera angle, and posture affect them. A visible unused phone can count as distracted, and a phone outside the camera view cannot be detected. Recalibrate after moving your laptop or notes. If your face is not visible while reading, use manual studying. Brief blinks/glances are smoothed. Uncertain views, multiple faces, camera-off time, hidden tabs, and computer sleep are unobserved. Tracking pauses during breaks; **Turn off** releases the camera.

Focus rate = focused / (focused + distracted); coverage = observed / all study time. Manual minutes are identified in the journal and CSV. A high focus rate with low coverage does not describe the whole block.

## Repository files

`index.html` contains the full GitHub Pages app, including its interface, timer, browser journal, and camera worker. `.nojekyll` lets Pages serve it directly. Existing Python files remain available for the earlier local edition; they are not used by the website.

To update the website, replace **index.html** at the top level of this repository. No folder uploads or Python hosting are needed.
