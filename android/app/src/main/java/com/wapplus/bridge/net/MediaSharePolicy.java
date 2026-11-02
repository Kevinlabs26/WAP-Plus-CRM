package com.wapplus.bridge.net;

public final class MediaSharePolicy {
    private static final long TIMEOUT_MS = 120_000;

    private MediaSharePolicy() {}

    public static boolean isTrustedProvider(String packageName) {
        return "com.whatsapp".equals(packageName) || "com.whatsapp.w4b".equals(packageName);
    }

    public static boolean isFresh(long preparedAt, long now) {
        return preparedAt >= 0 && now >= preparedAt && now - preparedAt <= TIMEOUT_MS;
    }

    public static boolean isCurrentRequest(long ticket, long currentTicket, long preparedAt, long now) {
        return ticket == currentTicket && isFresh(preparedAt, now);
    }
}
