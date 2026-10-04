package com.wapplus.bridge.net;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;

/** Bounds allocations before reading untrusted socket lines or shared files. */
public final class BoundedInput {
    private BoundedInput() {}

    public static String readLine(Reader input, int limit) throws IOException {
        StringBuilder line = new StringBuilder();
        int c;
        while ((c = input.read()) != -1 && c != '\n') {
            if (line.length() >= limit) throw new IOException("Bridge line too large");
            line.append((char) c);
        }
        if (c == -1 && line.length() == 0) return null;
        if (line.length() > 0 && line.charAt(line.length() - 1) == '\r') line.setLength(line.length() - 1);
        return line.toString();
    }

    public static byte[] readBytes(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (count > limit - result.size()) throw new IOException("Shared file too large");
            result.write(buffer, 0, count);
        }
        return result.toByteArray();
    }
}
