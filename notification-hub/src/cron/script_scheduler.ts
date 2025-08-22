import { CronJob } from 'cron';
import { pool } from '../db';
import { executeScript } from '../runtime/script_executor';

// Store active cron jobs
const activeJobs = new Map<string, CronJob>();

// Load and schedule all active scripts
export async function initializeScheduler() {
  console.log('[SCHEDULER] Initializing script scheduler...');
  
  try {
    // Get all active scheduled scripts
    const { rows: scripts } = await pool.query(
      `SELECT 
        id, 
        name, 
        schedule_cron,
        channel_id
      FROM channel_scripts 
      WHERE trigger_type = 'schedule' 
      AND is_active = true 
      AND schedule_cron IS NOT NULL`
    );

    console.log(`[SCHEDULER] Found ${scripts.length} scheduled scripts`);

    for (const script of scripts) {
      scheduleScript(script);
    }

    // Check for new/updated scripts every minute
    setInterval(async () => {
      await refreshSchedules();
    }, 60000);

  } catch (error: any) {
    console.error('[SCHEDULER] Failed to initialize:', error);
  }
}

// Schedule a single script
function scheduleScript(script: any) {
  try {
    // Stop existing job if any
    if (activeJobs.has(script.id)) {
      const existingJob = activeJobs.get(script.id);
      existingJob?.stop();
      activeJobs.delete(script.id);
    }

    // Validate cron expression
    if (!script.schedule_cron) {
      console.log(`[SCHEDULER] Script ${script.id} has no cron expression`);
      return;
    }

    // Create new cron job
    const job = new CronJob(
      script.schedule_cron,
      async () => {
        console.log(`[SCHEDULER] Executing scheduled script: ${script.name} (${script.id})`);
        
        const trigger = {
          source: 'schedule',
          cron: script.schedule_cron,
          timestamp: new Date().toISOString()
        };

        try {
          const result = await executeScript(script.id, trigger);
          
          console.log(`[SCHEDULER] Script ${script.id} execution complete:`, {
            success: result.success,
            notificationsSent: result.notificationsSent,
            duration: result.duration,
            error: result.error
          });
        } catch (error: any) {
          console.error(`[SCHEDULER] Script ${script.id} execution failed:`, error);
        }
      },
      null, // onComplete
      true, // start immediately
      'UTC' // timezone
    );

    activeJobs.set(script.id, job);
    console.log(`[SCHEDULER] Scheduled script: ${script.name} (${script.id}) with cron: ${script.schedule_cron}`);

  } catch (error: any) {
    console.error(`[SCHEDULER] Failed to schedule script ${script.id}:`, error);
  }
}

// Refresh schedules (check for new/updated/deleted scripts)
async function refreshSchedules() {
  try {
    const { rows: scripts } = await pool.query(
      `SELECT 
        id, 
        name, 
        schedule_cron,
        channel_id,
        updated_at
      FROM channel_scripts 
      WHERE trigger_type = 'schedule' 
      AND is_active = true 
      AND schedule_cron IS NOT NULL`
    );

    const currentScriptIds = new Set(scripts.map(s => s.id));

    // Remove jobs for deleted/inactive scripts
    for (const [scriptId, job] of activeJobs.entries()) {
      if (!currentScriptIds.has(scriptId)) {
        console.log(`[SCHEDULER] Removing job for script ${scriptId}`);
        job.stop();
        activeJobs.delete(scriptId);
      }
    }

    // Add/update jobs for active scripts
    for (const script of scripts) {
      const existingJob = activeJobs.get(script.id);
      
      // Check if cron expression changed
      if (existingJob) {
        const existingCron = (existingJob as any).cronTime?.source;
        if (existingCron !== script.schedule_cron) {
          console.log(`[SCHEDULER] Updating schedule for script ${script.id}`);
          scheduleScript(script);
        }
      } else {
        // New script
        console.log(`[SCHEDULER] Adding new scheduled script ${script.id}`);
        scheduleScript(script);
      }
    }
  } catch (error: any) {
    console.error('[SCHEDULER] Failed to refresh schedules:', error);
  }
}

// Stop all scheduled jobs
export function stopScheduler() {
  console.log('[SCHEDULER] Stopping all scheduled scripts...');
  
  for (const [scriptId, job] of activeJobs.entries()) {
    job.stop();
  }
  
  activeJobs.clear();
}

// Update schedule for a specific script
export async function updateScriptSchedule(scriptId: string) {
  try {
    const { rows } = await pool.query(
      `SELECT 
        id, 
        name, 
        schedule_cron,
        channel_id,
        is_active,
        trigger_type
      FROM channel_scripts 
      WHERE id = $1`,
      [scriptId]
    );

    if (rows.length === 0) {
      console.log(`[SCHEDULER] Script ${scriptId} not found`);
      return;
    }

    const script = rows[0];

    // Remove existing job
    if (activeJobs.has(scriptId)) {
      const existingJob = activeJobs.get(scriptId);
      existingJob?.stop();
      activeJobs.delete(scriptId);
      console.log(`[SCHEDULER] Removed existing job for script ${scriptId}`);
    }

    // Schedule if active and scheduled
    if (script.is_active && script.trigger_type === 'schedule' && script.schedule_cron) {
      scheduleScript(script);
    }
  } catch (error: any) {
    console.error(`[SCHEDULER] Failed to update script ${scriptId}:`, error);
  }
}
