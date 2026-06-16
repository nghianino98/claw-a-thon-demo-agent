import { WorkflowEditor } from "@/components/workflows/workflow-editor";

export default async function EditWorkflowPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params;

    return <WorkflowEditor workflowId={id} />;
}
