use anchor_lang::prelude::*;

declare_id!("9tN5NBvynubfJwQWDqrSoHEE3Xy2MVj3BmHdLu13wCcS");

#[program]
pub mod whatsapp_sol {
    use super::*;
pub fn initialize_thread(
        ctx: Context<InitializeThread>,
        thread_id: [u8; 32],
    ) -> Result<()> {
        let thread = &mut ctx.accounts.message_thread;
        
        thread.participant_a = ctx.accounts.participant_a.key();
        thread.participant_b = ctx.accounts.participant_b.key();
        thread.thread_id = thread_id;
        thread.message_count = 0;
        thread.created_at = Clock::get()?.unix_timestamp;
        thread.last_message_at = 0;

        msg!("Message thread initialized!");
        msg!("Participant A: {}", thread.participant_a);
        msg!("Participant B: {}", thread.participant_b);
        msg!("Thread ID: {:?}", thread_id);

        Ok(())
    }

    /// Send a message in a thread
    /// The message content is stored in transaction data, not in the PDA
    pub fn send_message(
        ctx: Context<SendMessage>,
        message_index: u32,
        _encrypted_content: Vec<u8>, // Prefixed with _ since we don't store it
    ) -> Result<()> {
        let thread = &mut ctx.accounts.message_thread;
        let sender = ctx.accounts.sender.key();
        
        // Verify sender is a participant
        require!(
            sender == thread.participant_a || sender == thread.participant_b,
            MessagingError::UnauthorizedSender
        );

        // Verify message index is sequential
        require!(
            message_index == thread.message_count,
            MessagingError::InvalidMessageIndex
        );

        thread.message_count += 1;
        thread.last_message_at = Clock::get()?.unix_timestamp;

        msg!("Message {} sent by {}", message_index, sender);
        msg!("Thread messages: {}", thread.message_count);

        Ok(())
    }

    /// Send a broadcast message to all subscribers
    pub fn send_broadcast(
        ctx: Context<SendBroadcast>,
        message_index: u32,
        _encrypted_content: Vec<u8>,
    ) -> Result<()> {
        let channel = &mut ctx.accounts.broadcast_channel;
        
        require!(
            ctx.accounts.sender.key() == channel.owner,
            MessagingError::UnauthorizedSender
        );

        require!(
            message_index == channel.message_count,
            MessagingError::InvalidMessageIndex
        );

        channel.message_count += 1;
        channel.last_broadcast_at = Clock::get()?.unix_timestamp;

        msg!("Broadcast {} sent", message_index);
        msg!("Total broadcasts: {}", channel.message_count);

        Ok(())
    }

    /// Initialize a broadcast channel
    pub fn initialize_channel(
        ctx: Context<InitializeChannel>,
        channel_name: String,
    ) -> Result<()> {
        let channel = &mut ctx.accounts.broadcast_channel;
        
        require!(
            channel_name.len() <= 32,
            MessagingError::ChannelNameTooLong
        );

        channel.owner = ctx.accounts.owner.key();
        channel.channel_name = channel_name;
        channel.message_count = 0;
        channel.subscriber_count = 0;
        channel.created_at = Clock::get()?.unix_timestamp;
        channel.last_broadcast_at = 0;

        msg!("Broadcast channel initialized!");
        msg!("Owner: {}", channel.owner);
        msg!("Channel: {}", channel.channel_name);

        Ok(())
    }

    /// Subscribe to a broadcast channel
    pub fn subscribe_channel(ctx: Context<SubscribeChannel>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        let channel = &mut ctx.accounts.broadcast_channel;
        
        subscription.subscriber = ctx.accounts.subscriber.key();
        subscription.channel = channel.key();
        subscription.subscribed_at = Clock::get()?.unix_timestamp;
        subscription.last_read_index = 0;

        channel.subscriber_count += 1;

        msg!("Subscribed to channel: {}", channel.channel_name);
        msg!("Total subscribers: {}", channel.subscriber_count);

        Ok(())
    }

    /// Close a message thread and refund rent
    pub fn close_thread(ctx: Context<CloseThread>) -> Result<()> {
        let thread = &ctx.accounts.message_thread;

        msg!("Closing message thread");
        msg!("Messages exchanged: {}", thread.message_count);
        msg!("Refunding rent to: {}", ctx.accounts.recipient.key());

        Ok(())
    }

    /// Close a broadcast channel
    pub fn close_channel(ctx: Context<CloseChannel>) -> Result<()> {
        let channel = &ctx.accounts.broadcast_channel;

        msg!("Closing broadcast channel: {}", channel.channel_name);
        msg!("Total broadcasts: {}", channel.message_count);
        msg!("Subscribers: {}", channel.subscriber_count);

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(thread_id: [u8; 32])]
pub struct InitializeThread<'info> {
    #[account(
        init,
        payer = participant_a,
        space = 8 + MessageThread::INIT_SPACE,
        seeds = [
            b"message_thread",
            participant_a.key().as_ref(),
            participant_b.key().as_ref(),
            thread_id.as_ref()
        ],
        bump
    )]
    pub message_thread: Account<'info, MessageThread>,
    
    #[account(mut)]
    pub participant_a: Signer<'info>,
    
    /// CHECK: Participant B doesn't need to sign for initialization
    pub participant_b: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(message_index: u32)]
pub struct SendMessage<'info> {
    #[account(mut)]
    pub message_thread: Account<'info, MessageThread>,
    
    pub sender: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(channel_name: String)]
pub struct InitializeChannel<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + BroadcastChannel::INIT_SPACE,
        seeds = [
            b"broadcast_channel",
            owner.key().as_ref(),
            channel_name.as_bytes()
        ],
        bump
    )]
    pub broadcast_channel: Account<'info, BroadcastChannel>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubscribeChannel<'info> {
    #[account(
        init,
        payer = subscriber,
        space = 8 + ChannelSubscription::INIT_SPACE,
        seeds = [
            b"subscription",
            broadcast_channel.key().as_ref(),
            subscriber.key().as_ref()
        ],
        bump
    )]
    pub subscription: Account<'info, ChannelSubscription>,
    
    #[account(mut)]
    pub broadcast_channel: Account<'info, BroadcastChannel>,
    
    #[account(mut)]
    pub subscriber: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(message_index: u32)]
pub struct SendBroadcast<'info> {
    #[account(mut)]
    pub broadcast_channel: Account<'info, BroadcastChannel>,
    
    pub sender: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseThread<'info> {
    #[account(
        mut,
        has_one = participant_a @ MessagingError::UnauthorizedSender,
        close = recipient
    )]
    pub message_thread: Account<'info, MessageThread>,
    
    pub participant_a: Signer<'info>,
    
    /// CHECK: Recipient can be any account
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseChannel<'info> {
    #[account(
        mut,
        has_one = owner @ MessagingError::UnauthorizedSender,
        close = recipient
    )]
    pub broadcast_channel: Account<'info, BroadcastChannel>,
    
    pub owner: Signer<'info>,
    
    /// CHECK: Recipient can be any account
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct MessageThread {
    /// First participant (thread initiator)
    pub participant_a: Pubkey,
    
    /// Second participant
    pub participant_b: Pubkey,
    
    /// Unique thread identifier
    pub thread_id: [u8; 32],
    
    /// Total number of messages sent
    pub message_count: u32,
    
    /// Timestamp of thread creation
    pub created_at: i64,
    
    /// Timestamp of last message
    pub last_message_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct BroadcastChannel {
    /// Channel owner (broadcaster)
    pub owner: Pubkey,
    
    /// Channel name (max 32 chars)
    #[max_len(32)]
    pub channel_name: String,
    
    /// Total messages broadcast
    pub message_count: u32,
    
    /// Number of subscribers
    pub subscriber_count: u32,
    
    /// Timestamp of channel creation
    pub created_at: i64,
    
    /// Timestamp of last broadcast
    pub last_broadcast_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct ChannelSubscription {
    /// Subscriber's public key
    pub subscriber: Pubkey,
    
    /// Channel being subscribed to
    pub channel: Pubkey,
    
    /// When subscription was created
    pub subscribed_at: i64,
    
    /// Last message index read by subscriber
    pub last_read_index: u32,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum MessagingError {
    #[msg("You are not authorized to send messages in this thread")]
    UnauthorizedSender,
    
    #[msg("Message index must be sequential")]
    InvalidMessageIndex,
    
    #[msg("Channel name cannot exceed 32 characters")]
    ChannelNameTooLong,
    
    #[msg("Thread is closed and cannot receive new messages")]
    ThreadClosed,
}