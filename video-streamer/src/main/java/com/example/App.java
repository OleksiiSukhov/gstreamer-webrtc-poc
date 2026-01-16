package com.example;

/**
 * GStreamer WebRTC Streamer - Entry Point
 *
 * Build and run:
 *   mvn package exec:java
 *
 * Run without rebuild:
 *   mvn exec:java -Dexec.mainClass="com.example.App"
 *
 * Arguments:
 *   --test-pattern  Use test pattern instead of video file
 */
public class App {
    public static void main(String[] args) {
        boolean useVideoFile = true;

        // Check for --test-pattern argument
        for (String arg : args) {
            if ("--test-pattern".equals(arg)) {
                useVideoFile = false;
                break;
            }
        }

        WebRTCStreamer streamer = new WebRTCStreamer();
        streamer.start(useVideoFile);
    }
}
