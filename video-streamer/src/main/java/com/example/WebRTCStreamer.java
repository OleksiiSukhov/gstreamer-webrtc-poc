package com.example;

import org.freedesktop.gstreamer.*;
import org.freedesktop.gstreamer.glib.Natives;
import org.freedesktop.gstreamer.webrtc.WebRTCBin;
import org.freedesktop.gstreamer.webrtc.WebRTCSDPType;
import org.freedesktop.gstreamer.webrtc.WebRTCSessionDescription;

import com.sun.jna.Callback;
import com.sun.jna.Library;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.ptr.LongByReference;

import io.socket.client.IO;
import io.socket.client.Socket;
import org.json.JSONObject;

import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ConcurrentLinkedQueue;

public class WebRTCStreamer {
    private static final String SIGNALING_URL = "http://localhost:3001";
    private static final String VIDEO_FILE = "src/main/resources/earth_hd.mp4";

    private Socket socket;
    private Pipeline pipe;
    private WebRTCBin webrtcbin;

    // Data channel callbacks (using JNA Pointer for compatibility)
    public interface DATA_CHANNEL_LISTENER extends Callback {
        void callback(Pointer webrtcbin, Pointer dataChannel, Pointer userData);
    }

    public interface DC_EVENT_LISTENER extends Callback {
        void callback(Pointer dataChannel, Pointer userData);
    }

    public interface DC_MESSAGE_LISTENER extends Callback {
        void callback(Pointer dataChannel, String message, Pointer userData);
    }

    public interface DC_BINARY_LISTENER extends Callback {
        void callback(Pointer dataChannel, Pointer data, Pointer userData);
    }

    // JNA interface for GLib functions to handle GBytes
    public interface GLib extends Library {
        GLib INSTANCE = Native.load("glib-2.0", GLib.class);
        Pointer g_bytes_get_data(Pointer bytes, LongByReference size);
        long g_bytes_get_size(Pointer bytes);
    }

    // Queue ICE candidates until answer is sent
    private final ConcurrentLinkedQueue<IceCandidate> pendingIceCandidates = new ConcurrentLinkedQueue<>();
    private volatile boolean answerSent = false;

    private static class IceCandidate {
        final int sdpMLineIndex;
        final String candidate;

        IceCandidate(int sdpMLineIndex, String candidate) {
            this.sdpMLineIndex = sdpMLineIndex;
            this.candidate = candidate;
        }
    }

    public void start(boolean useVideoFile) {
        try {
            System.out.println("\n========================================");
            System.out.println("   GStreamer WebRTC Streamer");
            System.out.println("========================================\n");

            // Initialize GStreamer and verify installation
            if (!initializeAndVerifyGStreamer()) {
                System.exit(1);
            }

            connectToSignaling();
            buildPipeline(useVideoFile);
            startPipeline();

            Gst.main();

        } catch (Exception e) {
            System.err.println("ERROR: " + e.getMessage());
            e.printStackTrace();
            cleanup();
            System.exit(1);
        }
    }

    private boolean initializeAndVerifyGStreamer() {
        System.out.println("Initializing GStreamer...");

        try {
            Gst.init(Version.of(1, 20));
        } catch (Exception | UnsatisfiedLinkError e) {
            System.err.println("ERROR: Failed to initialize GStreamer");
            System.err.println("Make sure GStreamer is installed on your system.");
            System.err.println("Details: " + e.getMessage());
            return false;
        }

        Version version = Gst.getVersion();
        System.out.println("GStreamer version: " + version.getMajor() + "." + version.getMinor() + "." + version.getMicro());

        // Verify required plugins
        System.out.println("\nVerifying required plugins...");
        String[] requiredPlugins = {
            "videotestsrc", "filesrc", "decodebin", "videoconvert", "videorate",
            "queue", "vp8enc", "rtpvp8pay", "webrtcbin"
        };

        boolean allFound = true;
        for (String pluginName : requiredPlugins) {
            ElementFactory factory = ElementFactory.find(pluginName);
            if (factory != null) {
                System.out.println("  [OK] " + pluginName);
            } else {
                System.err.println("  [MISSING] " + pluginName);
                allFound = false;
            }
        }

        if (!allFound) {
            System.err.println("\nERROR: Some required plugins are missing.");
            System.err.println("Install them with: sudo apt-get install -y gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav");
            return false;
        }

        System.out.println("\nAll required plugins available.\n");
        return true;
    }

    private void startPipeline() {
        System.out.println("Starting pipeline...");
        StateChangeReturn ret = pipe.play();

        if (ret == StateChangeReturn.FAILURE) {
            System.err.println("ERROR: Failed to start pipeline");
            System.exit(1);
        }

        System.out.println("Pipeline started. Waiting for viewer connection...\n");
    }

    private String getVideoFilePipeline() {
        System.out.println("Using video file: " + VIDEO_FILE);
        return "filesrc location=" + VIDEO_FILE + " ! decodebin ! videoconvert ! videorate ! " +
                "video/x-raw,framerate=30/1 ! queue ! " +
                "vp8enc deadline=1 ! rtpvp8pay pt=96 ! " +
                "queue ! application/x-rtp,media=video,encoding-name=VP8,payload=96 ! webrtcbin. " +
                "webrtcbin name=webrtcbin bundle-policy=max-bundle stun-server=stun://stun.l.google.com:19302";
    }

    private String getTestPatternPipeline() {
        System.out.println("Using test pattern (moving ball)");
        return "videotestsrc is-live=true pattern=ball ! videoconvert ! queue ! " +
                "vp8enc deadline=1 ! rtpvp8pay pt=96 ! " +
                "queue ! application/x-rtp,media=video,encoding-name=VP8,payload=96 ! webrtcbin. " +
                "webrtcbin name=webrtcbin bundle-policy=max-bundle stun-server=stun://stun.l.google.com:19302";
    }

    private void buildPipeline(boolean useVideoFile) {
        System.out.println("Building pipeline...");
        String pipelineDesc = useVideoFile ? getVideoFilePipeline() : getTestPatternPipeline();

        pipe = (Pipeline) Gst.parseLaunch(pipelineDesc);
        webrtcbin = (WebRTCBin) pipe.getElementByName("webrtcbin");

        if (webrtcbin == null) {
            System.err.println("ERROR: Failed to get webrtcbin from pipeline");
            System.exit(1);
        }

        // ICE candidate handler
        webrtcbin.connect((WebRTCBin.ON_ICE_CANDIDATE) (sdpMLineIndex, candidate) -> {
            if (!answerSent) {
                pendingIceCandidates.offer(new IceCandidate(sdpMLineIndex, candidate));
            } else {
                sendIceCandidate(sdpMLineIndex, candidate);
            }
        });

        // Data channel handler
        var dcCallback = new DATA_CHANNEL_LISTENER() {
            @Override
            public void callback(Pointer webrtcbin, Pointer dataChannel, Pointer userData) {
                System.out.println("[DataChannel] Received from viewer");
                attachDataChannelHandlers(dataChannel);
            }
        };
        webrtcbin.connect("on-data-channel", GstObject.class, (GstObject) null, dcCallback);

        // Bus message handlers
        Bus bus = pipe.getBus();

        bus.connect((Bus.ERROR) (source, code, message) -> {
            System.err.println("Pipeline ERROR: " + message);
            Gst.quit();
        });

        bus.connect((Bus.EOS) source -> {
            System.out.println("End of stream");
            Gst.quit();
        });

        bus.connect((Bus.STATE_CHANGED) (source, old, current, pending) -> {
            if (source == pipe) {
                System.out.println("Pipeline: " + old + " -> " + current);
            }
        });

        System.out.println("Pipeline built successfully.\n");
    }

    private void connectToSignaling() {
        try {
            System.out.println("Connecting to signaling server: " + SIGNALING_URL);

            socket = IO.socket(new URI(SIGNALING_URL));

            socket.on(Socket.EVENT_CONNECT, args -> {
                System.out.println("Connected to signaling server");
                try {
                    JSONObject register = new JSONObject();
                    register.put("role", "streamer");
                    socket.emit("register", register);
                    System.out.println("Registered as streamer\n");
                } catch (Exception e) {
                    System.err.println("ERROR registering: " + e.getMessage());
                }
            });

            socket.on(Socket.EVENT_DISCONNECT, args -> {
                System.out.println("Disconnected from signaling server");
            });

            socket.on(Socket.EVENT_CONNECT_ERROR, args -> {
                System.err.println("Signaling connection error: " + (args.length > 0 ? args[0] : "unknown"));
            });

            socket.on("offer", args -> {
                if (args.length > 0) {
                    System.out.println("\n[Signaling] Received offer from viewer");
                    handleOffer(args[0]);
                }
            });

            socket.on("candidate", args -> {
                if (args.length > 0) {
                    handleRemoteIceCandidate(args[0]);
                }
            });

            socket.connect();
        } catch (Exception e) {
            System.err.println("Failed to connect to signaling: " + e.getMessage());
            System.exit(1);
        }
    }

    private void handleOffer(Object offerData) {
        try {
            JSONObject offerJson = new JSONObject(offerData.toString());
            JSONObject sdpJson = offerJson.getJSONObject("offer");
            String sdpString = sdpJson.getString("sdp");

            System.out.println("[Signaling] Setting remote description...");
            SDPMessage sdpMessage = new SDPMessage();
            sdpMessage.parseBuffer(sdpString);
            WebRTCSessionDescription offer = new WebRTCSessionDescription(WebRTCSDPType.OFFER, sdpMessage);
            webrtcbin.setRemoteDescription(offer);

            System.out.println("[Signaling] Creating answer...");
            webrtcbin.createAnswer(answer -> {
                webrtcbin.setLocalDescription(answer);

                new Thread(() -> {
                    try {
                        Thread.sleep(1000); // Wait for ICE gathering
                        WebRTCSessionDescription localDesc = webrtcbin.getLocalDescription();
                        if (localDesc != null) {
                            sendAnswer(localDesc.getSDPMessage().toString());
                            answerSent = true;
                            flushPendingIceCandidates();
                        }
                    } catch (InterruptedException e) {
                        System.err.println("ERROR: Answer sending interrupted");
                    }
                }).start();
            });

        } catch (Exception e) {
            System.err.println("ERROR handling offer: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private void sendAnswer(String sdpString) {
        try {
            JSONObject answerMessage = new JSONObject();
            JSONObject answerSdp = new JSONObject();
            answerSdp.put("type", "answer");
            answerSdp.put("sdp", sdpString);
            answerMessage.put("answer", answerSdp);

            socket.emit("answer", answerMessage);
            System.out.println("[Signaling] Answer sent to viewer");
        } catch (Exception e) {
            System.err.println("ERROR sending answer: " + e.getMessage());
        }
    }

    private void sendIceCandidate(int sdpMLineIndex, String candidate) {
        try {
            JSONObject candidateMessage = new JSONObject();
            JSONObject candidateData = new JSONObject();
            candidateData.put("candidate", candidate);
            candidateData.put("sdpMLineIndex", sdpMLineIndex);
            candidateMessage.put("to", "viewer");
            candidateMessage.put("candidate", candidateData);

            socket.emit("candidate", candidateMessage);
        } catch (Exception e) {
            System.err.println("ERROR sending ICE candidate: " + e.getMessage());
        }
    }

    private void handleRemoteIceCandidate(Object candidateData) {
        try {
            JSONObject candidateJson = new JSONObject(candidateData.toString());
            JSONObject candidate = candidateJson.getJSONObject("candidate");
            String candidateStr = candidate.getString("candidate");
            int sdpMLineIndex = candidate.getInt("sdpMLineIndex");

            webrtcbin.addIceCandidate(sdpMLineIndex, candidateStr);
        } catch (Exception e) {
            System.err.println("ERROR handling ICE candidate: " + e.getMessage());
        }
    }

    private void flushPendingIceCandidates() {
        System.out.println("[Signaling] Flushing " + pendingIceCandidates.size() + " pending ICE candidates");
        while (!pendingIceCandidates.isEmpty()) {
            IceCandidate ice = pendingIceCandidates.poll();
            if (ice != null) {
                sendIceCandidate(ice.sdpMLineIndex, ice.candidate);
            }
        }
    }

    private void attachDataChannelHandlers(Pointer dataChannelPtr) {
        GstObject dataChannel = Natives.objectFor(dataChannelPtr, GstObject.class, false, true);

        dataChannel.connect("on-open", DC_EVENT_LISTENER.class, null,
            (DC_EVENT_LISTENER) (dc, userData) -> System.out.println("[DataChannel] OPENED"));

        dataChannel.connect("on-close", DC_EVENT_LISTENER.class, null,
            (DC_EVENT_LISTENER) (dc, userData) -> System.out.println("[DataChannel] CLOSED"));

        dataChannel.connect("on-error", DC_EVENT_LISTENER.class, null,
            (DC_EVENT_LISTENER) (dc, userData) -> System.err.println("[DataChannel] ERROR"));

        dataChannel.connect("on-message-string", String.class, null,
            (DC_MESSAGE_LISTENER) (dc, message, userData) -> {
                System.out.println("[DataChannel] Text message: " + message);
                GstObject dcObj = Natives.objectFor(dc, GstObject.class, false, true);
                dcObj.emit("send-string", "Echo: " + message);
            });

        dataChannel.connect("on-message-data", Pointer.class, null,
            (DC_BINARY_LISTENER) (dc, gbytes, userData) -> {
                try {
                    LongByReference sizeRef = new LongByReference();
                    Pointer dataPtr = GLib.INSTANCE.g_bytes_get_data(gbytes, sizeRef);
                    long size = sizeRef.getValue();

                    if (dataPtr != null && size > 0) {
                        byte[] bytes = dataPtr.getByteArray(0, (int) size);
                        GstObject dcObj = Natives.objectFor(dc, GstObject.class, false, true);
                        handleBinaryMessage(dcObj, bytes);
                    }
                } catch (Exception e) {
                    System.err.println("Error handling binary message: " + e.getMessage());
                }
            });
    }

    private void handleBinaryMessage(GstObject dataChannel, byte[] data) {
        if (data.length < 1) return;

        byte messageType = data[0];
        switch (messageType) {
            case 0: // Keyboard
                handleKeyboardEvent(data);
                break;
            case 1: // Mouse
                handleMouseEvent(data);
                break;
            case 2: // Mouse wheel
                handleMouseWheelEvent(data);
                break;
            case 6: // JSON message
                handleJsonMessage(dataChannel, data);
                break;
            default:
                System.out.println("[DataChannel] Unknown message type: " + messageType);
        }
    }

    private void handleKeyboardEvent(byte[] data) {
        if (data.length < 5) return;

        int eventType = data[1]; // 0=keyup, 1=keydown
        int isRepeat = data[2];
        int keyCode = data[3] & 0xFF;
        int charCode = data[4] & 0xFF;

        String eventName = eventType == 0 ? "KEY_UP" : "KEY_DOWN";
        String repeatStr = isRepeat == 1 ? " (repeat)" : "";
        char character = charCode > 31 && charCode < 127 ? (char) charCode : '?';

        System.out.println("[Keyboard] " + eventName + ": keyCode=" + keyCode +
                          ", char='" + character + "' (code=" + charCode + ")" + repeatStr);
    }

    private void handleMouseEvent(byte[] data) {
        if (data.length < 6) return;

        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        buffer.get(); // skip type byte
        int x = buffer.getShort();
        int y = buffer.getShort();
        int buttons = buffer.get() & 0xFF;

        String buttonStr = "";
        if ((buttons & 1) != 0) buttonStr += "LEFT ";
        if ((buttons & 2) != 0) buttonStr += "RIGHT ";
        if ((buttons & 4) != 0) buttonStr += "MIDDLE ";
        if (buttonStr.isEmpty()) buttonStr = "NONE";

        System.out.println("[Mouse] pos=(" + x + ", " + y + ") buttons=" + buttonStr.trim());
    }

    private void handleMouseWheelEvent(byte[] data) {
        if (data.length < 9) return;

        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        buffer.get(); // skip type byte
        float deltaX = buffer.getFloat();
        float deltaY = buffer.getFloat();

        System.out.println("[MouseWheel] deltaX=" + deltaX + ", deltaY=" + deltaY);
    }

    private void handleJsonMessage(GstObject dataChannel, byte[] data) {
        try {
            String jsonString = new String(data, 1, data.length - 1).trim();
            System.out.println("\n[Message] Received JSON:");
            System.out.println("  " + jsonString);

            JSONObject message = new JSONObject(jsonString);
            String messageName = message.optString("Name", "unknown");

            // Log message details
            System.out.println("[Message] Processing: " + messageName);

            // Create response
            JSONObject response = new JSONObject();
            response.put("Name", messageName);
            response.put("Success", true);
            response.put("Message", "Message '" + messageName + "' received and processed");

            // Add demo data to response
            JSONObject demoData = new JSONObject();
            demoData.put("timestamp", System.currentTimeMillis());
            demoData.put("streamerVersion", "1.0.0");
            response.put("Data", demoData);

            String responseJson = response.toString();
            dataChannel.emit("send-string", responseJson);

            System.out.println("[Message] Response sent:");
            System.out.println("  " + responseJson + "\n");

        } catch (Exception e) {
            System.err.println("[Message] Error: " + e.getMessage());
            try {
                JSONObject errorResponse = new JSONObject();
                errorResponse.put("Success", false);
                errorResponse.put("Error", e.getMessage());
                dataChannel.emit("send-string", errorResponse.toString());
            } catch (Exception ex) {
                // ignore
            }
        }
    }

    private void cleanup() {
        if (pipe != null) {
            pipe.stop();
            pipe.setState(State.NULL);
        }
        if (socket != null) {
            socket.disconnect();
            socket.close();
        }
        Gst.deinit();
    }
}
