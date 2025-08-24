// Channel Management JavaScript Functions
// To be integrated into renderer.html

// Global state for channel management
let currentManagedChannel = null;
let channelsList = [];
let messageHistory = [];

// Initialize channel management
async function initChannelManagement() {
  devlog('initChannelManagement: starting');
  await refreshChannels();
  updateChannelStats();
}

// Refresh channels list
async function refreshChannels() {
  devlog('refreshChannels: fetching channels');
  
  try {
    const result = await receiver.invoke('channels:list');
    
    if (result.channels) {
      channelsList = result.channels;
      renderChannelCards(channelsList);
      updateChannelStats();
      devlog(`refreshChannels: loaded ${channelsList.length} channels`);
    }
  } catch (error) {
    devlog(`refreshChannels error: ${error}`);
    showToast('Failed to load channels', 'error');
  }
}

// Render channel cards
function renderChannelCards(channels) {
  const container = document.getElementById('channels-container');
  
  if (!channels || channels.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <p class="empty-title h5">No channels yet</p>
        <p class="empty-subtitle">Create your first channel to get started</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = channels.map(channel => `
    <div class="channel-card" data-channel-id="${channel.short_id}">
      <div class="channel-header">
        <div>
          <div class="channel-title">${escapeHtml(channel.name)}</div>
          <span class="channel-badge ${channel.allow_public ? 'badge-public' : 'badge-private'}">
            ${channel.allow_public ? 'Public' : 'Private'}
          </span>
        </div>
        <div>
          <code class="text-gray">${channel.short_id}</code>
        </div>
      </div>
      
      ${channel.description ? `<p class="text-gray">${escapeHtml(channel.description)}</p>` : ''}
      
      <div class="channel-stats">
        <span><i class="icon icon-people"></i> <span id="subs-${channel.short_id}">--</span> subscribers</span>
        <span><i class="icon icon-message"></i> ${channel.topic || 'runs.finished'}</span>
      </div>
      
      <div class="channel-actions">
        <button class="btn btn-primary btn-sm" onclick="openChannelManager('${channel.short_id}')">
          <i class="icon icon-edit"></i> Manage
        </button>
        <button class="btn btn-sm" onclick="quickSendMessage('${channel.short_id}')">
          <i class="icon icon-send"></i> Quick Message
        </button>
        <button class="btn btn-sm" onclick="copyChannelLink('${channel.short_id}')">
          <i class="icon icon-link"></i> Copy Link
        </button>
      </div>
    </div>
  `).join('');
  
  // Load subscriber counts
  channels.forEach(channel => {
    loadSubscriberCount(channel.short_id);
  });
}

// Load subscriber count for a channel
async function loadSubscriberCount(shortId) {
  try {
    const result = await receiver.invoke('channels:users', { shortId });
    const count = result.users ? result.users.length : 0;
    const element = document.getElementById(`subs-${shortId}`);
    if (element) {
      element.textContent = count;
    }
  } catch (error) {
    devlog(`loadSubscriberCount error for ${shortId}: ${error}`);
  }
}

// Open channel manager modal
async function openChannelManager(shortId) {
  const channel = channelsList.find(c => c.short_id === shortId);
  if (!channel) return;
  
  currentManagedChannel = channel;
  
  // Update modal header
  document.getElementById('manage-channel-title').textContent = channel.name;
  document.getElementById('manage-channel-name').textContent = channel.name;
  document.getElementById('manage-channel-id').textContent = channel.short_id;
  document.getElementById('manage-channel-type').textContent = channel.allow_public ? 'Public' : 'Private';
  document.getElementById('manage-channel-topic').textContent = channel.topic || 'runs.finished';
  
  // Load settings
  document.getElementById('edit-channel-name').value = channel.name;
  document.getElementById('edit-channel-desc').value = channel.description || '';
  document.getElementById('edit-channel-public').checked = channel.allow_public;
  
  // Show modal
  document.getElementById('manage-channel-modal').classList.add('active');
  
  // Load subscribers
  showManageTab('subscribers');
}

// Show management tab
function showManageTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.manage-tab-content').forEach(tab => {
    tab.style.display = 'none';
  });
  
  // Remove active class from all tab items
  document.querySelectorAll('#manage-channel-modal .tab-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Show selected tab
  document.getElementById(`manage-${tabName}-tab`).style.display = 'block';
  
  // Add active class to selected tab item
  document.querySelector(`#manage-channel-modal .tab-item[data-tab="${tabName}"]`).classList.add('active');
  
  // Load tab-specific data
  if (tabName === 'subscribers') {
    loadChannelSubscribers();
  } else if (tabName === 'message') {
    loadRecentMessages();
  }
}

// Load channel subscribers
async function loadChannelSubscribers() {
  if (!currentManagedChannel) return;
  
  try {
    const result = await receiver.invoke('channels:users', { 
      shortId: currentManagedChannel.short_id 
    });
    
    const subscribers = result.users || [];
    document.getElementById('subscriber-count').textContent = subscribers.length;
    
    const listContainer = document.getElementById('subscriber-list');
    
    if (subscribers.length === 0) {
      listContainer.innerHTML = '<div class="empty">No subscribers yet</div>';
    } else {
      listContainer.innerHTML = subscribers.map(user => `
        <div class="subscriber-item">
          <span>${user.phone || user.id}</span>
          <button class="btn btn-sm btn-error" onclick="removeSubscriber('${user.phone || user.id}')">
            <i class="icon icon-cross"></i>
          </button>
        </div>
      `).join('');
    }
  } catch (error) {
    devlog(`loadChannelSubscribers error: ${error}`);
    showToast('Failed to load subscribers', 'error');
  }
}

// Add subscriber
async function addSubscriber() {
  const phone = document.getElementById('add-subscriber-phone').value.trim();
  
  if (!phone) {
    showToast('Please enter a phone number', 'error');
    return;
  }
  
  if (!currentManagedChannel) return;
  
  try {
    const result = await receiver.invoke('channels:subscribe', {
      shortId: currentManagedChannel.short_id,
      phone: phone
    });
    
    if (result.ok !== false) {
      showToast('Subscriber added successfully');
      document.getElementById('add-subscriber-phone').value = '';
      loadChannelSubscribers();
    } else {
      showToast(`Failed to add subscriber: ${result.error}`, 'error');
    }
  } catch (error) {
    devlog(`addSubscriber error: ${error}`);
    showToast('Failed to add subscriber', 'error');
  }
}

// Remove subscriber
async function removeSubscriber(phone) {
  if (!currentManagedChannel) return;
  
  if (!confirm(`Remove ${phone} from this channel?`)) return;
  
  try {
    const result = await receiver.invoke('channels:unsubscribe', {
      shortId: currentManagedChannel.short_id,
      phone: phone
    });
    
    if (result.ok !== false) {
      showToast('Subscriber removed');
      loadChannelSubscribers();
    } else {
      showToast(`Failed to remove subscriber: ${result.error}`, 'error');
    }
  } catch (error) {
    devlog(`removeSubscriber error: ${error}`);
    showToast('Failed to remove subscriber', 'error');
  }
}

// Send message to channel
async function sendMessage() {
  const title = document.getElementById('message-title').value.trim();
  const body = document.getElementById('message-body').value.trim();
  
  if (!body) {
    showToast('Please enter a message', 'error');
    return;
  }
  
  if (!currentManagedChannel) return;
  
  try {
    const result = await receiver.invoke('channels:send', {
      shortId: currentManagedChannel.short_id,
      title: title || 'Channel Update',
      body: body
    });
    
    if (result.ok !== false) {
      showToast('Message sent successfully!');
      
      // Clear form
      document.getElementById('message-title').value = '';
      document.getElementById('message-body').value = '';
      
      // Add to history
      addToMessageHistory(title || 'Channel Update', body);
      
      // Update stats
      updateChannelStats();
    } else {
      showToast(`Failed to send message: ${result.error}`, 'error');
    }
  } catch (error) {
    devlog(`sendMessage error: ${error}`);
    showToast('Failed to send message', 'error');
  }
}

// Quick send message
async function quickSendMessage(shortId) {
  const message = prompt('Enter your message:');
  if (!message) return;
  
  try {
    const result = await receiver.invoke('channels:send', {
      shortId: shortId,
      title: 'Quick Update',
      body: message
    });
    
    if (result.ok !== false) {
      showToast('Message sent!');
      updateChannelStats();
    } else {
      showToast(`Failed to send: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('Failed to send message', 'error');
  }
}

// Use message template
function useTemplate(type) {
  const templates = {
    update: {
      title: 'Channel Update',
      body: 'Hello everyone! We have an important update to share with you.'
    },
    alert: {
      title: 'Important Alert',
      body: 'Attention: This is an important notification that requires your immediate attention.'
    },
    reminder: {
      title: 'Friendly Reminder',
      body: 'Just a friendly reminder about our upcoming event. Don\'t forget to mark your calendars!'
    }
  };
  
  const template = templates[type];
  if (template) {
    document.getElementById('message-title').value = template.title;
    document.getElementById('message-body').value = template.body;
  }
}

// Add to message history
function addToMessageHistory(title, body) {
  messageHistory.unshift({
    title: title,
    body: body,
    timestamp: new Date().toISOString(),
    channel: currentManagedChannel?.short_id
  });
  
  // Keep only last 10 messages
  messageHistory = messageHistory.slice(0, 10);
  
  loadRecentMessages();
}

// Load recent messages
function loadRecentMessages() {
  const container = document.getElementById('recent-messages');
  
  const channelMessages = messageHistory.filter(m => 
    m.channel === currentManagedChannel?.short_id
  );
  
  if (channelMessages.length === 0) {
    container.innerHTML = '<div class="empty">No recent messages</div>';
  } else {
    container.innerHTML = channelMessages.map(msg => `
      <div style="border: 1px solid #e7e9ed; padding: 8px; margin-bottom: 8px; border-radius: 4px;">
        <strong>${escapeHtml(msg.title)}</strong>
        <p class="text-gray" style="margin: 4px 0;">${escapeHtml(msg.body)}</p>
        <small class="text-gray">${new Date(msg.timestamp).toLocaleString()}</small>
      </div>
    `).join('');
  }
}

// Update channel stats
async function updateChannelStats() {
  const totalChannels = channelsList.length;
  document.getElementById('total-channels').textContent = totalChannels;
  
  // Count total subscribers across all channels
  let totalSubscribers = 0;
  for (const channel of channelsList) {
    try {
      const result = await receiver.invoke('channels:users', { 
        shortId: channel.short_id 
      });
      totalSubscribers += (result.users ? result.users.length : 0);
    } catch (error) {
      devlog(`updateChannelStats error: ${error}`);
    }
  }
  document.getElementById('total-subscribers').textContent = totalSubscribers;
  
  // Messages sent (from history)
  document.getElementById('messages-sent').textContent = messageHistory.length;
}

// Copy channel link
function copyChannelLink(shortId) {
  const link = `https://routed.app/join/${shortId}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('Channel link copied!');
  }).catch(() => {
    showToast('Failed to copy link', 'error');
  });
}

// Bulk add subscribers
async function bulkAddSubscribers() {
  const phonesText = document.getElementById('bulk-phone-numbers').value.trim();
  if (!phonesText) {
    showToast('Please enter phone numbers', 'error');
    return;
  }
  
  const phones = phonesText.split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);
  
  if (phones.length === 0) {
    showToast('No valid phone numbers', 'error');
    return;
  }
  
  let added = 0;
  let failed = 0;
  
  for (const phone of phones) {
    try {
      const result = await receiver.invoke('channels:subscribe', {
        shortId: currentManagedChannel.short_id,
        phone: phone
      });
      
      if (result.ok !== false) {
        added++;
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
    }
  }
  
  closeModal('add-subscribers-modal');
  document.getElementById('bulk-phone-numbers').value = '';
  
  showToast(`Added ${added} subscribers${failed > 0 ? `, ${failed} failed` : ''}`);
  loadChannelSubscribers();
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export functions for use in renderer
window.channelManager = {
  init: initChannelManagement,
  refresh: refreshChannels,
  openManager: openChannelManager,
  sendMessage: sendMessage,
  addSubscriber: addSubscriber,
  removeSubscriber: removeSubscriber,
  showManageTab: showManageTab
};
