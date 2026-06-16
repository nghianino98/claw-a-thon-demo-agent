CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_command_alias
ON skills(command_alias)
WHERE command_alias IS NOT NULL AND command_alias != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_command_alias
ON workflows(command_alias)
WHERE command_alias IS NOT NULL AND command_alias != '';
