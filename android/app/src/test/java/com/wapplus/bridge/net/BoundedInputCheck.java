package com.wapplus.bridge.net;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.StringReader;
import java.net.Socket;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class BoundedInputCheck {
    public static void main(String[] args) throws IOException {
        assert BoundedInput.readLine(new StringReader("ok\r\n"), 3).equals("ok");
        assert BoundedInput.readLine(new StringReader(""), 3) == null;
        assert BoundedInput.readLine(new StringReader("abc"), 3).equals("abc");
        assert BoundedInput.readBytes(new ByteArrayInputStream(new byte[3]), 3).length == 3;
        try { BoundedInput.readLine(new StringReader("abcd"), 3); throw new AssertionError("unbounded line"); }
        catch (IOException expected) {}
        try { BoundedInput.readBytes(new ByteArrayInputStream(new byte[4]), 3); throw new AssertionError("unbounded file"); }
        catch (IOException expected) {}
        checkWorkers();
        checkWriteTimeout();
        System.out.println("BoundedInputCheck passed");
    }

    private static void checkWriteTimeout() {
        Socket slow = new Socket();
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (BridgeWorkers workers = new BridgeWorkers(25)) {
            assert workers.response(slow, () -> {
                started.countDown();
                try { release.await(); }
                catch (InterruptedException stopped) { Thread.currentThread().interrupt(); }
            });
            assert started.await(5, TimeUnit.SECONDS);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (!slow.isClosed() && System.nanoTime() < deadline) Thread.sleep(2);
            assert slow.isClosed() : "stalled response must close the socket";
        } catch (InterruptedException interrupted) { throw new AssertionError(interrupted); }
        finally { release.countDown(); }
    }

    private static void checkWorkers() {
        CountDownLatch active = new CountDownLatch(4);
        CountDownLatch release = new CountDownLatch(1);
        try (BridgeWorkers workers = new BridgeWorkers()) {
            Runnable blocked = () -> {
                active.countDown();
                try { release.await(); }
                catch (InterruptedException stopped) { Thread.currentThread().interrupt(); }
            };
            for (int i = 0; i < 12; i++) assert workers.client(new Socket(), blocked);
            assert active.await(5, TimeUnit.SECONDS);
            Socket rejected = new Socket();
            assert !workers.client(rejected, blocked);
            assert rejected.isClosed();
            CountDownLatch responding = new CountDownLatch(2);
            Runnable blockedResponse = () -> {
                responding.countDown();
                try { release.await(); }
                catch (InterruptedException stopped) { Thread.currentThread().interrupt(); }
            };
            for (int i = 0; i < 34; i++) assert workers.response(new Socket(), blockedResponse);
            assert responding.await(5, TimeUnit.SECONDS);
            Socket rejectedResponse = new Socket();
            assert !workers.response(rejectedResponse, blockedResponse);
            assert rejectedResponse.isClosed();
        } catch (InterruptedException interrupted) { throw new AssertionError(interrupted); }
        finally { release.countDown(); }
    }
}
