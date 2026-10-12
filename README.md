# Focus Studio

A Python study timer with intentional breaks and optional, on-device camera attention estimates. Built for personal use on your own computer.

## Easiest way to open it

Unzip the complete project first. On a Mac, double-click **Start Focus Studio.command** inside the `focus-studio` folder. On Windows, double-click **Start Focus Studio.bat**. The launcher prepares a local environment on the first run, installs the requirements if needed, starts Python, waits until the app is ready, and opens your browser. Python 3.10+ must be installed; first-time setup needs internet.

Keep the terminal window open while using the app. The web page needs the Python server for saving and loading. If the terminal closes or the computer restarts, launch the app again and refresh the page. The launcher reuses an existing server and picks another local port if 5050 is occupied; use the address it prints. A downloaded ZIP may not preserve executable permission; if the Mac launcher will not open, use the terminal option below.

In VS Code, open the `focus-studio` folder, choose **Terminal → New Terminal**, and run just:

```sh
python3 launch.py
```

On Windows, use `py -3 launch.py`. If macOS displays a security prompt for a downloaded launcher, use the terminal command instead; no security settings need to be changed.

## Open it in VS Code

Copy the contents of this `focus-studio` folder into your cloned GitHub repository. Open that repository in VS Code. In **Terminal → New Terminal**, move into the folder containing `app.py`.

**Mac / Linux**

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

**Windows PowerShell**

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py
```

Open **http://localhost:5050** in Chrome or Edge. Keep the terminal running. Press Ctrl+C in the terminal to stop the server. If port 5050 is occupied, set the `PORT` environment variable to another port before running.

Python 3.10+ is required. No Node installation is needed to run the app. JavaScript runs the browser controls and camera; Python serves the application, validates data, saves settings and sessions to SQLite, and exports CSV. Browser camera access works on localhost; remote hosting requires HTTPS and a different authenticated deployment design. This project is intentionally served on `127.0.0.1` and has not been published.

## Your first session

1. Enter your subject and one goal.
2. Optionally enable your camera. Accept the browser camera prompt; no microphone is requested.
3. Capture your screen viewing position for three seconds.
4. Click to capture your paper-notes position, then immediately look down at your notes. Your face must remain visible. If capture fails, adjust lighting or camera angle and try again.
5. Put unused phones outside the camera view, then start your study block.
6. Use **Manual: studying** if camera estimates misread productive work. Use **Manual: distracted** for phone use that is out of view.

Default rhythm: **50-minute study → 15-minute short break**. Every fourth completed study block offers a **30-minute long break**, configurable to **60 minutes**. Every transition waits for your click; unattended breaks never silently roll into study time. Ending a block early saves it without advancing the cycle. Settings apply to the next block. Pauses and breaks are excluded from study totals.

Keyboard shortcuts: Space starts/pauses, F selects manual study, D selects manual distraction, A selects automatic tracking. Shortcuts are inactive while typing or using a dialog.

The supplied Tkinter base is a separate desktop-window app. Its task-name suggestions, Today/7 days/30 days/All sessions filters, and time-by-task bars are adapted into this web interface. The bars retain separate focused, distracted, and unobserved segments. They summarize the selected range of loaded sessions (latest 500), with the top 12 subjects displayed; CSV includes all saved records. The base code's 5-minute/15-minute break defaults are replaced with your requested 15-minute short break and 30- or 60-minute long break.

## What the camera actually measures

- MediaPipe Face Landmarker runs in a browser worker at up to eight samples per second. Iris positions and head geometry form a small feature vector compared against your personal calibrated positions. This is a heuristic viewing estimate, not a validated gaze tracker or a measure of learning.
- A TensorFlow.js COCO-SSD model checks for visible phones about every 1.5 seconds. Two consecutive detections are required. **Phone visibility does not establish phone usage.** A phone sitting in frame can produce distraction time; a phone under the desk cannot be detected. Disable phone detection or correct the mode manually when needed.
- Changes are smoothed for about 1.6 seconds. Brief blinks are tolerated. Missing/uncertain faces, multiple faces, camera-off periods, hidden tabs, and delayed timer ticks are unobserved. Closed eyes eventually become unobserved rather than focused.
- Screen and notes estimates require calibration. Recalibrate after moving the camera, laptop, chair, or notes. Glasses, poor lighting, small faces, extreme head angles, and tracking occlusions can reduce accuracy.
- The camera stays on while enabled, but image inference pauses on breaks and while this tab is hidden. Click **Turn off** to release the camera. No raw frames are recorded or sent to Python.
- Focus rate = focused / (focused + distracted). Coverage = observed / study duration. Manual time is identified in the journal and CSV; a good focus rate with low coverage does not imply a full session was focused.

The camera libraries and model files are downloaded from jsDelivr and Google on first enable. Internet is needed to load them. These providers receive normal asset requests (including IP address), not your camera frames. Timer, manual tracking, and journaling do not require those models. Model loading can take a minute on a slow connection. The app gracefully falls back to manual tracking if a model is unavailable.

## Storage and recovery

The app creates `instance/focus.sqlite3` on first launch. It stores session titles, intentions, totals, status, and settings. It never stores camera images, recordings, or face landmarks. Calibration means/variances and a resumable timer snapshot stay in browser local storage.

Sessions checkpoint in the browser about once per second, and sync to Python about every 15 seconds and on pause/finish. A refresh restores a paused block from the latest checkpoint; time while the browser is closed is not counted. A sleeping computer's delayed tick becomes unobserved and is capped at the end of the block. Unsynced totals are retried when Python reconnects. Clearing browser storage can lose unsynced time and calibration. Export CSV before moving computers. Daily totals group sessions by their local start date. The visible journal loads the latest 500 sessions and displays up to 100; CSV exports all saved sessions.

Use one active app tab per browser profile. The app uses browser Web Locks to prevent a second tab from controlling the timer where supported. Multiple browsers or devices can still create separate sessions. It is a single-user app, with no login or multi-user isolation. Do not expose its development server to the internet. Local host checks and cross-origin protections are included.

The `.gitignore` excludes your virtual environment, personal database, and Python caches. Commit application code and the README to GitHub; your study records stay on your computer.

## Checks

```sh
python -m unittest discover -s tests -v
node --test tests/timing.test.mjs
```

The second command needs Node 22+. It checks accounting, sleeping/throttled intervals, recovery, calibration, and screen/notes classification. Server tests verify validation, durable saves, retry behavior, stale snapshot protection, export, and localhost access rules. Live gaze and phone detection accuracy must be assessed with your own camera, lighting, and posture; synthetic tests cannot validate real-world accuracy.

Optional browser model check: with Python running, open `http://localhost:5050/static/_model-check.html` and click **Check model initialization**. It exercises both models on a blank generated image without requesting camera access. Both should display `PASS`; the first run downloads model assets.

Camera implementation references: [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [TensorFlow.js COCO-SSD](https://github.com/tensorflow/tfjs-models/blob/master/coco-ssd/README.md). Python implementation uses [Flask](https://flask.palletsprojects.com/en/stable/).
