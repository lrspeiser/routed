-- Channel Scripts: Store LLM-generated notification scripts for channels
-- These scripts can be triggered via webhooks or scheduled events

-- Table for storing channel scripts
CREATE TABLE IF NOT EXISTS channel_scripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Script metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    request_prompt TEXT NOT NULL, -- The user's request for what the script should do
    api_docs TEXT, -- API documentation provided by the developer
    
    -- Generated script
    generated_code TEXT, -- The LLM-generated code
    runtime VARCHAR(50) DEFAULT 'javascript', -- Script runtime (javascript, python, etc)
    
    -- Execution configuration
    trigger_type VARCHAR(50) NOT NULL CHECK (trigger_type IN ('webhook', 'schedule', 'manual')),
    webhook_path VARCHAR(255), -- Unique webhook path if trigger_type = 'webhook'
    schedule_cron VARCHAR(255), -- Cron expression if trigger_type = 'schedule'
    
    -- Security
    webhook_secret VARCHAR(255), -- Secret for webhook authentication
    max_executions_per_hour INTEGER DEFAULT 60,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    last_executed_at TIMESTAMPTZ,
    execution_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for user-configurable variables
CREATE TABLE IF NOT EXISTS script_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID NOT NULL REFERENCES channel_scripts(id) ON DELETE CASCADE,
    
    -- Variable definition
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    variable_type VARCHAR(50) NOT NULL CHECK (variable_type IN ('string', 'number', 'boolean', 'select', 'location')),
    
    -- Validation
    is_required BOOLEAN DEFAULT true,
    default_value TEXT,
    validation_regex VARCHAR(500),
    min_value NUMERIC,
    max_value NUMERIC,
    
    -- For select type
    allowed_values JSONB, -- Array of {value, label} objects
    
    -- Display order
    display_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for user-provided variable values
CREATE TABLE IF NOT EXISTS user_script_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    script_id UUID NOT NULL REFERENCES channel_scripts(id) ON DELETE CASCADE,
    variable_id UUID NOT NULL REFERENCES script_variables(id) ON DELETE CASCADE,
    
    -- User's value for this variable
    value TEXT NOT NULL,
    
    -- Validation status
    is_valid BOOLEAN DEFAULT true,
    validation_error TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, variable_id)
);

-- Table for script execution logs
CREATE TABLE IF NOT EXISTS script_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID NOT NULL REFERENCES channel_scripts(id) ON DELETE CASCADE,
    
    -- Trigger information
    trigger_source VARCHAR(50) NOT NULL, -- 'webhook', 'schedule', 'manual', 'test'
    trigger_data JSONB, -- Webhook payload or other trigger data
    
    -- Execution details
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Results
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'success', 'error', 'timeout')),
    error_message TEXT,
    
    -- Notifications sent
    notifications_sent INTEGER DEFAULT 0,
    notification_details JSONB, -- Array of {userId, status, error} objects
    
    -- Resource usage
    memory_used_mb INTEGER,
    cpu_time_ms INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_channel_scripts_channel_id ON channel_scripts(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_scripts_webhook_path ON channel_scripts(webhook_path) WHERE webhook_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_scripts_is_active ON channel_scripts(is_active);
CREATE INDEX IF NOT EXISTS idx_script_variables_script_id ON script_variables(script_id);
CREATE INDEX IF NOT EXISTS idx_user_script_variables_user_script ON user_script_variables(user_id, script_id);
CREATE INDEX IF NOT EXISTS idx_script_execution_logs_script_id ON script_execution_logs(script_id);
CREATE INDEX IF NOT EXISTS idx_script_execution_logs_created_at ON script_execution_logs(created_at);

-- Create unique index for webhook paths
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_scripts_unique_webhook ON channel_scripts(webhook_path) 
WHERE webhook_path IS NOT NULL AND is_active = true;
