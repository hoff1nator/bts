bts - Badminton Tournament Software
==========

Use [bup](https://github.com/phihag/bup/) at tournaments.

## Docker installation

[Install docker](https://docs.docker.com/install/) and run

```
docker run -p 4000:4000 phihag/bts
```

## Manual installation

To install, type

    make

To start, type

	make run  # Production mode
	make dev  # Development mode

# Usage

To start a display, go to http://IP:4000/d2 , where 2 is the court number (alternatively, just `/d`).
To start an umpire panel, go to http://IP:4000/u2 , where 2 is the court number (alternatively, just `/u`).

# Helper scripts

- `./fetch-btp.js` - Fetch data from BTP via TPNetwork protocol
- `div/decode.js` - Decode VisualReality hex format

# Additional screens and scripts for management of tournaments without umpires
		Additional screens accessable from tournament admin panel:
		- courts to call
		- court overview
		Player Attendance and Result Screen for each Field/Tablet are accessable via https://IP:4000/r2 where 2 is the court number
		
Together with changes in BUP it tracks the normal tournament lifecycle:
Game Dragged on Field in BTP -> Players Called to Field -> Players Present At Field ->Playing -> Result Entry -> Free Field ->Restart
