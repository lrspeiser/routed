-- Check if scripts tables exist
SELECT 
    table_name,
    CASE 
        WHEN table_name IS NOT NULL THEN 'EXISTS'
        ELSE 'MISSING'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('channel_scripts', 'script_variables', 'user_script_variables', 'script_execution_logs')
ORDER BY table_name;
