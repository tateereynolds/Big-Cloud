#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  print "Install Python 3.10 or newer from python.org, then try again."
  read "?Press Enter to close this window."
  exit 1
fi
python3 launch.py
if [[ $? -ne 0 ]]; then
  read "?The app could not start. Read the message above. Press Enter to close."
fi
