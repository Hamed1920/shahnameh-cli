// What kind of generation a queued job was. Rules, first match wins:
//  1. stage 'final' with a parent whose stage was 'draft'  -> final_of_draft
//  2. enqueued by 'panel:regenerate'                        -> edit
//  3. attempt > 1, or a parent job, or a retryOf            -> revision
//  4. otherwise                                             -> generate
export type OperationType = 'generate' | 'edit' | 'revision' | 'final_of_draft';

export type OperationInput = {
  parentJobId?: string | null;
  parentStage?: string | null;
  stage?: string | null;
  attempt?: number | null;
  enqueuedBy?: string | null;
  retryOf?: string | null;
};

export function operationType(i: OperationInput): OperationType {
  if (i.stage === 'final' && i.parentJobId && i.parentStage === 'draft') return 'final_of_draft';
  if (i.enqueuedBy === 'panel:regenerate') return 'edit';
  if ((i.attempt ?? 1) > 1 || i.parentJobId || i.retryOf) return 'revision';
  return 'generate';
}
