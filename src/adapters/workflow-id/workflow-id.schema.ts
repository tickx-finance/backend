import { BaseParsedEvent } from 'src/utils/base/base-parsed-event';

// ==================== ENUMS ====================
export enum WorkflowIdEvent {
  ExpectedWorkflowIdUpdated = 'ExpectedWorkflowIdUpdated',
}

// ==================== DTOs ====================
export class ExpectedWorkflowIdUpdatedDto {
  previousId: string;
  newId: string;
}

// ==================== Parsed Events ====================
export class ParsedExpectedWorkflowIdUpdatedEvent extends BaseParsedEvent {
  type: WorkflowIdEvent.ExpectedWorkflowIdUpdated;
  args: ExpectedWorkflowIdUpdatedDto;
}

// ==================== Response ====================
export class WorkflowIdEventResponse {
  expectedWorkflowIdUpdatedEvents: ParsedExpectedWorkflowIdUpdatedEvent[];
}
