# GStreamer WebRTC PoC

Simple but complete example of GStreamer with [WebRTC](https://www.w3.org/TR/webrtc/) integration. The video streamer generates a video pipeline and streams it to the browser (video channel). The browser and streamer communicate over a data channel; the browser sends keyboard and mouse events to the streamer.

**Note 1:** This is a PoC/example project — not a production-ready solution. It is intentionally simplified and covers only the happy path.

**Note 2:** WebRTC requires STUN and TURN servers. For localhost, TURN configuration can be omitted for simplicity; free Google STUN servers are used by default. See [coturn](https://github.com/coturn/coturn) for a free, open-source TURN/STUN server implementation.

The PoC project has three components:

1. **Web Viewer** - Browser WebRTC client ([web component](https://developer.mozilla.org/en-US/docs/Web/API/Web_components), TypeScript)
2. **Signaling Server** - Socket.IO signaling for WebRTC negotiation (Node.js, TypeScript)
3. **Video Streamer** - Console application that streams [GStreamer](https://gstreamer.freedesktop.org/) video via WebRTC (Java)

**Demo:**
![Demo](./demo.png)

## Architecture

```
┌─────────────┐  WebSocket  ┌──────────────────┐  WebSocket  ┌─────────────────┐
│ Web Viewer  │ < ─────── > │ Signaling Server │ < ─────── > │ Video Streamer  │
│  (Browser)  │             │   (Socket.IO)    │             │   (GStreamer)   │
└─────────────┘             └──────────────────┘             └─────────────────┘
       ^                                                              ^
       │                WebRTC (Video + DataChannel)                  │
       └──────────────────────────────────────────────────────────────┘
```

## Components

### Web Viewer

A TypeScript web component that displays the WebRTC video stream, and a simple web page to host it.

**Location:** `web-viewer/`

**Tech Stack:** TypeScript, Vite, Socket.IO Client, RxJS, Inversify

**Build & Run:**

```bash
cd web-viewer
npm install
npm run dev      # Development server at http://localhost:5173
```

**Usage:**

The viewer is available as a web component `<webrtc-viewer>`:

```html
<webrtc-viewer></webrtc-viewer>
```

### Signaling Server

Simple Socket.IO-based signaling server for WebRTC negotiation between a single viewer-streamer pair.

**Location:** `signaling/`

**Tech Stack:** TypeScript, Express, Socket.IO

**Build & Run:**

```bash
cd signaling
npm install
npm run dev      # Development server at http://localhost:3001
```

**Status endpoint:** `GET http://localhost:3001/` returns current connection status.

### Video Streamer

Java application using GStreamer to stream video via WebRTC.

**Location:** `video-streamer/`

**Tech Stack:** Java 11+, GStreamer 1.x, gst1-java-core, Socket.IO Client, Maven

**Prerequisites:**

- GStreamer 1.x installed with plugins: `vpx`, `rtp`, `webrtc`, `nice`, `dtls`, `srtp`
- `sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-nice`

**Build & Run:**

```bash
cd video-streamer
mvn exec:java -Dexec.mainClass="com.example.App"
```

**Features:**

- Verifies GStreamer installation and required plugins at startup
- Two video source modes: test pattern or video file
- WebRTC data channel for bidirectional communication
- Handles keyboard, mouse, and wheel events from viewer
- Supports JSON messages with responses

## Quick Start

1. Start the signaling server (port 3001)
2. Start the video streamer
3. Start the web viewer
4. Open http://localhost:5173 in your browser
5. Click "Connect" to initiate the WebRTC connection

## Configuration

The web viewer can be configured via `web-viewer/src/viewer/config.ts`:

- `signalingUrl` - Signaling server URL (default: `http://localhost:3001`)
- `webrtc.preferredCodec` - Preferred video codec (VP8, H264, VP9)


## Useful links:
- [GStreamer has built-in WebRTC API](https://gstreamer.freedesktop.org/documentation/webrtclib/index.html?gi-language=c)
- [webrtcbin](https://gstreamer.freedesktop.org/documentation/webrtc/index.html?gi-language=c)
- [gst1-java-core - Java bindings for GStreamer (without data channel though)](https://github.com/gstreamer-java/gst1-java-core)
- [gst1-java-core WebRTC example](https://github.com/gstreamer-java/gst1-java-examples/blob/master/WebRTCSendRecv/src/main/java/org/freedesktop/gstreamer/examples/WebRTCSendRecv.java)
- [Good article: WebRTC Plumbing with GStreamer](https://webrtchacks.com/webrtc-plumbing-with-gstreamer/)
- [WebRTC Crash Course](https://www.youtube.com/watch?v=FExZvpVvYxA)
