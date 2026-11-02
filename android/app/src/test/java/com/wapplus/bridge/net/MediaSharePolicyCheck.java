package com.wapplus.bridge.net;

public final class MediaSharePolicyCheck {
    public static void main(String[] args) {
        assert MediaSharePolicy.isTrustedProvider("com.whatsapp");
        assert MediaSharePolicy.isTrustedProvider("com.whatsapp.w4b");
        for (String value : new String[] {null, "", "com.whatsapp.evil", "com.whatsapp.w4b.fake", "attacker.example"}) {
            assert !MediaSharePolicy.isTrustedProvider(value);
        }
        assert MediaSharePolicy.isFresh(1000, 121000);
        assert !MediaSharePolicy.isFresh(1000, 121001);
        assert !MediaSharePolicy.isFresh(1000, 999);
        assert !MediaSharePolicy.isFresh(-1, 1000);
        assert MediaSharePolicy.isCurrentRequest(2, 2, 1000, 2000);
        assert !MediaSharePolicy.isCurrentRequest(1, 2, 1000, 2000);
        assert !MediaSharePolicy.isCurrentRequest(2, 2, 1000, 121001);
        System.out.println("media share source, expiry and request binding checks passed");
    }
}
