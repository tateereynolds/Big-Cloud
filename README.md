# Focus Studio — simple upload edition

Everything needed for the interface and camera controls is included inside app.py.
No static or templates folders are required.

## Upload to GitHub

Upload all files in this folder directly to the top level of your repository.
If you already uploaded the previous version, replace app.py with this version.
Existing loose JavaScript, CSS, HTML, and test files can remain; this edition does not load them.

## Run on your computer

Install Python 3.10 or newer. Open a terminal in this folder and run:

    python3 launch.py

On Windows, use:

    py -3 launch.py

Or double-click Start Focus Studio.command on Mac / Start Focus Studio.bat on Windows.
First-time setup needs internet. Keep the terminal open while studying.
Open the localhost address printed in the terminal.

The app runs locally. Uploading its code to GitHub does not publish a running website.

## Camera and breaks

Default: 50 minutes studying, 15 minutes for a short break, and a 30-minute long break after four completed blocks. Long breaks can be changed to 60 minutes.

Enable the camera, calibrate your screen and paper-notes positions, and start a block. Manual study and distracted modes are available. Camera estimates cannot measure learning; a visible unused phone can be flagged, and a phone outside the camera view can be missed. Libraries and models download from jsDelivr and Google. Images are processed in the browser and are not saved or uploaded. Python stores session totals locally in instance/focus.sqlite3, excluded from GitHub by .gitignore.
