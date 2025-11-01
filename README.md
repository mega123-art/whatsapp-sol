# 1. Initialize a Direct Message Thread
$ sol-msg init-thread -r G9hQf4dF23... -c devnet
# Output will give the Thread PDA: <THREAD_PDA>

# 2. Send an Encrypted Message (using a shared key 'mykey')
$ sol-msg send -t <THREAD_PDA> -m "Are you there?" -k mykey

# 3. Read Messages (using the same key)
$ sol-msg read -t <THREAD_PDA> -k mykey

# 4. Create a Broadcast Channel
$ sol-msg create-channel -n "DevAnnouncements"
# Output will give the Channel PDA: <CHANNEL_PDA>

# 5. Subscribe to the Channel (as a different user if desired)
$ sol-msg subscribe -ch <CHANNEL_PDA>

# 6. Send a Broadcast (using the channel owner's wallet and key 'channelkey')
$ sol-msg send-broadcast -ch <CHANNEL_PDA> -m "New project launch imminent." -k channelkey

# 7. Read Broadcasts
$ sol-msg read-broadcasts -ch <CHANNEL_PDA> -k channelkey
