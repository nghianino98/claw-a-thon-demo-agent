from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.registry import parse_frontmatter


@dataclass
class WorkflowSpec:
    workflow_id: str
    description: str
    system: str
    steps: list[str]


def parse_workflow(workflow_id: str, text: str) -> WorkflowSpec:
    meta, body = parse_frontmatter(text)
    description = meta.get("description", "")
    lines = body.splitlines()
    step_lines: list[str] = []
    system_lines: list[str] = []
    in_steps = False
    found_steps_heading = False
    for line in lines:
        if line.startswith("##"):
            heading = line.lower()
            in_steps = "quy trình" in heading or "steps" in heading or "step" in heading
            found_steps_heading = found_steps_heading or in_steps
            if not in_steps:
                system_lines.append(line)
            continue
        if in_steps:
            step_lines.append(line)
        else:
            system_lines.append(line)
    steps = _numbered_steps("\n".join(step_lines))
    if not steps and not found_steps_heading:
        steps = _numbered_steps(body)
    if not steps:
        steps = [body.strip()]
    system = "\n".join(system_lines).strip()
    return WorkflowSpec(workflow_id=workflow_id, description=description, system=system, steps=[step for step in steps if step.strip()])


def _numbered_steps(text: str) -> list[str]:
    steps: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        if re.match(r"^\s*\d+\.\s+", line):
            if current:
                steps.append("\n".join(current).strip())
            current = [re.sub(r"^\s*\d+\.\s+", "", line).strip()]
        elif current:
            current.append(line)
    if current:
        steps.append("\n".join(current).strip())
    return steps

