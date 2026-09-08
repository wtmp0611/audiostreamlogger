This is the AudioStreamLogger!

This project contains a multi-service Docker application for recording, cleaning, generating peak files, and serving a frontend for audio files. The setup uses Docker Compose to manage the services and their interactions.

This is William's fork of the original project by Dennis (denhoo4/audiostreamlogger), with a number of fixes and new features added on top. All credit for the original design goes to Dennis - see "What's different from the original" below for what has changed in this fork.

Prerequisites

	•	Docker: Install Docker
	•	Docker Compose (the "docker compose" plugin that comes built into modern Docker - not the older, separate "docker-compose" tool, which is no longer maintained)

Project Structure

	•	recorder: Service to record audio streams, with automatic codec detection (see "Recording behavior" below).
	•	cleaner: Service to clean up audio files older than the configured retention period.
	•	peakfilegenerator: Service to generate waveform peak files from recorded audio files, used by the frontend to draw the waveform quickly.
	•	frontend: Service to provide a web interface to listen to, browse and download recordings.
	•	audio: Directory to store audio files (not tracked in git - this can grow very large).
	•	settings.json: Configuration file for the application.

Getting Started

    1.	Clone the repository:
        git clone https://github.com/<your-username>/audiostreamlogger.git
        cd audiostreamlogger

    2.	Build and run the application:
        docker compose up --build -d

    3.	Access the application:
        Open your browser and navigate to http://localhost:9703 (or whichever PORT you set in the .env file - see "Configuration" below).

    For every other command you'll need day-to-day (stopping, restarting, rebuilding, checking status, viewing logs), see "Command overview" below - this is the single place all of them are collected.

Command overview

    All commands below are run from the audiostreamlogger folder (the one containing docker-compose.yml). Replace <service> with one of: recorder, cleaner, peakfilegenerator, frontend. Leaving <service> out entirely runs the command against ALL services at once.

    On some systems these commands need "sudo" in front (sudo docker compose ...) - this depends on whether your user account was added to the "docker" group.

    Starting:
        docker compose up -d [<service>]
            Starts (or resumes) the container(s) in the background.

    Stopping:
        docker compose stop [<service>]
            Stops the container(s), but keeps them around (nothing is deleted).
        docker compose down
            Stops AND removes the containers. Nothing important is lost by this: audio/ and settings.json live on disk outside the containers, not inside them.

    Restarting (after changing settings.json only - no code change):
        docker compose restart <service>
            Restarts one service so it re-reads settings.json (see "Configuration" below for why this is needed). This briefly interrupts whatever that service was doing - for the recorder, that means the recording in progress for that hour gets cut short.

    Rebuilding (after an actual code change):
        docker compose build <service>
        docker compose up -d <service>
            Rebuilds the image from the new code, then restarts the container from that new image. Only rebuild the service(s) you actually changed - this also interrupts that service the same way a restart does.

    Checking what's running:
        docker compose ps
            Lists every service and whether it's currently running.

    Viewing logs:
        docker compose logs -f <service>
            Follows the live log output of one service (Ctrl+C to stop watching - this does NOT stop the service itself).
        docker compose logs -f
            Follows the live log output of ALL services at once, interleaved.
        docker compose logs --tail 50 <service>
            Shows only the last 50 lines, instead of dumping the entire log history.
        docker compose logs --since 10m <service>
            Shows only log lines from the last 10 minutes.
        docker compose logs -f -t --tail 100 <service>
            The most-used combination in practice: shows the last 100 lines with a timestamp in front of each line, then keeps following live. Ctrl+C to stop watching.

Configuration

    The application is configured using the settings.json file. This file specifies the streams to be recorded, the log retention, and the exact minute of every hour that the recorder, cleaner, and peakfilegenerator each run.

    Example settings.json:

    {
        "log_retention": 244,
        "recorder": {
            "recorder_minute": 0,
            "duration_minutes": 61
        },
        "cleaner": {
            "cleaner_minute": 59
        },
        "peakfilegenerator": {
            "peakfile_minute": 2
        },
        "streams": [
            {
                "country": "Netherlands",
                "name": "Glow_FM",
                "folder": "glowfm",
                "url": "https://stream.glowfm.nl/glowfm.mp3"
            },
            {
                "country": "Netherlands",
                "name": "RTV_Connect",
                "folder": "rtvconnect",
                "url": "https://stream.rtvconnect.nl/radio/8000/ffm-320-mp3"
            }
        ]
    }

    Each "..._minute" value must be a whole number between 0 and 59, and sets at which minute of every hour that service runs (for example, "recorder_minute": 0 means a new recording round starts at xx:00 every hour, for every configured station at once).

    "duration_minutes" (under "recorder") sets how long each individual recording lasts, in minutes. This is independent of when the NEXT recording round starts - that moment is always determined by "recorder_minute" above, not by how long the previous recording took. This field is optional - if it's missing or invalid, it defaults to 61 minutes.

    TIP: the original project always recorded exactly 60 minutes. This fork defaults to 61 minutes instead, so each recording overlaps the start of the next recording round by 1 minute - meaning there's never a small gap between two hours if a recording starts a fraction of a second late. The only downside is that, for that one overlapping minute, the recorder is briefly downloading the same stream twice (a little bit of extra bandwidth) - it causes no other problems. Set "duration_minutes": 60 if you'd rather have the original, non-overlapping behavior.

    log_retention is in hours - recordings older than this are removed by the cleaner.

    Note: settings.json is only read when a service starts up, not automatically re-read every hour. After changing settings.json, restart the affected service(s) for the change to take effect - see "Command overview" above.

    In the .env file the port the webserver is hosted on can be changed. This is an example:

    PORT=9703

Recording behavior (added in this fork)

    The recorder no longer blindly transcodes every stream to a fixed MP3 bitrate. Instead, for every new recording it first checks (with ffprobe) what the source stream is actually delivering at that moment:

	•	Source is already MP3 or FLAC: the recording is saved unchanged (stream-copied, no transcoding, no quality loss).
	•	Source is AAC, Opus, Vorbis or WMA: the recording is transcoded to MP3, using a target bitrate chosen from a lookup table based on the source's own bitrate (so a low-bitrate source doesn't get needlessly upscaled to a high MP3 bitrate).
	•	If the source format or bitrate can't be determined: falls back to the old, safe default of a 160kbps MP3.

    This is logged per station at the start of every recording round, for example:
        SAM Ibiza: bron is AAC @ 386kbps, wordt getranscodeerd naar MP3 @ 320kbps.
        Wild FM: bron is MP3 @ 320kbps, wordt ongewijzigd opgeslagen (geen transcoding).

Build performance note

    The audio/ folder (and backup/, .git/, and a few other folders - see .dockerignore) is deliberately excluded from the Docker build context. Without this, "docker compose build" would copy the entire audio archive into the build on every single rebuild, which can take hours or even days once it has grown large. With .dockerignore in place, a rebuild only takes a few seconds regardless of how much audio you have stored. Do not remove .dockerignore.

What's different from the original (denhoo4/audiostreamlogger)

	•	Codec-aware transcoding in the recorder (see "Recording behavior" above), instead of always transcoding every stream to a fixed MP3 bitrate regardless of the source.
	•	Recording length ("duration_minutes") is now configurable in settings.json instead of fixed in the code, and defaults to 61 minutes (1 minute of overlap between recordings) instead of the original 60 - see "Configuration" above.
	•	Frontend: a station/date/hour picker (hours without a recording for the selected station/date are shown greyed out and can't be clicked), a loading progress bar with a "now loading <filename>" display, a clear on-screen message when a chosen recording doesn't exist instead of the page hanging, a permanent per-visitor background color picker (saved in a cookie), and a consistent height/font/color across every button and input field on the page.
	•	Various small bug fixes found and fixed while running this fork in production (see the commit history of this fork for details).

Credits

    Original project and design: Dennis (github.com/denhoo4/audiostreamlogger).
    Changes in this fork: William.
