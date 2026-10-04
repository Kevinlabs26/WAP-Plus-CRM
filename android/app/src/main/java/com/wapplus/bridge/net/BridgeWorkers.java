package com.wapplus.bridge.net;

import java.io.IOException;
import java.net.Socket;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Bounded workers: no thread or queue growth from local socket floods. */
public final class BridgeWorkers implements AutoCloseable {
    private final ScheduledThreadPoolExecutor timeouts = new ScheduledThreadPoolExecutor(1);
    private final long writeTimeoutMillis;
    private final ThreadPoolExecutor clients = new ThreadPoolExecutor(
            4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));
    private final ThreadPoolExecutor responses = new ThreadPoolExecutor(
            2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32));

    public BridgeWorkers() { this(30_000); }
    BridgeWorkers(long writeTimeoutMillis) {
        this.writeTimeoutMillis = writeTimeoutMillis;
        timeouts.setRemoveOnCancelPolicy(true);
    }

    public boolean client(Socket socket, Runnable work) { return submit(clients, socket, work); }
    public boolean response(Socket socket, Runnable work) {
        return submit(responses, socket, () -> {
            var timeout = timeouts.schedule(() -> closeSocket(socket), writeTimeoutMillis, TimeUnit.MILLISECONDS);
            try { work.run(); } finally { timeout.cancel(false); }
        });
    }

    private static boolean submit(ThreadPoolExecutor pool, Socket socket, Runnable work) {
        try { pool.execute(work); return true; }
        catch (RejectedExecutionException overloaded) {
            closeSocket(socket);
            return false;
        }
    }

    private static void closeSocket(Socket socket) {
        try { socket.close(); } catch (IOException ignored) { }
    }

    @Override public void close() {
        clients.shutdownNow();
        responses.shutdownNow();
        timeouts.shutdownNow();
    }
}
