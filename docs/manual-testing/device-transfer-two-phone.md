# Device transfer: two-phone manual test

Device transfer requires a Geniuz+ EAS development build on two iOS or Android
phones. It does not work in Expo Go. Do not treat the automated protocol harness
as a real-device test.

## Before testing

- Build and install the same development build on both phones.
- Deploy the transfer API and the unapplied `transfer_sessions` migration through
  the normal release process; do not use `supabase db push`.
- Sign in on both phones. Receiving is free. Sending remains deliberately
  blocked until the later Membership task supplies a real server-verified
  entitlement; use an active test Member account only after that integration.
- Download a movie or episode to the sender phone and verify it plays offline.
- Connect both phones to the same Wi-Fi network or hotspot, with internet
  access available for creating and authorizing the transfer session.

## Test

1. On the receiver phone, open Downloads > Received and tap **Start receiving**.
   Confirm that a session code appears and that the screen explains it expires.
2. On the sender phone, open Downloads > Received, select the downloaded title,
   paste the receiver's code, and tap **Send file**.
3. Confirm the sender reports completion only after the receiver verifies the
   file hash. Confirm the receiver shows the received item and it plays from
   local storage with internet access disabled.
4. Repeat with a larger download. During transfer, briefly interrupt the local
   connection without closing either app, restore the same network, and confirm
   the sender reconnects from the last acknowledged chunk. Confirm that the
   receiver has only one copy.
5. Cancel a transfer from the sender and stop the receive session. Confirm that
   the incomplete file is not listed as a completed download.
6. On a non-member sender account, confirm that the backend rejects sending
   with an active-membership-required response. Confirm that the receiver can
   still receive without a paid membership.

Record phone models, OS versions, build identifier, account entitlement state,
and each observed result before claiming device transfer works on real phones.
