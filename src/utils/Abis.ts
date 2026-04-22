// ==================== Contract ABI Interfaces ====================

// Common event signatures for all contracts that emit ExpectedWorkflowIdUpdated
export const workflowIdUpdatedAbiInterface = [
  'event ExpectedWorkflowIdUpdated(bytes32 indexed previousId, bytes32 indexed newId)',
];

export enum WorkflowIdUpdatedAbi {
  ExpectedWorkflowIdUpdated = 'ExpectedWorkflowIdUpdated(bytes32,bytes32)',
}
