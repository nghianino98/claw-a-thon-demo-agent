"use client";

import { useState } from "react";
import { WorkflowEditor } from "@/components/workflows/workflow-editor";

export default function NewWorkflowPage() {
    // Basic ID generation for new unsaved workflows
    const [tempId] = useState(() => `new-workflow-${Date.now()}`);
    return <WorkflowEditor workflowId={tempId} />;
}
