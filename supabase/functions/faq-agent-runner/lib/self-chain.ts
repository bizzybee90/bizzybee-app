export function assertQueueOwnedExecution(): never {
  throw new Error(
    'faq-agent-runner self-chaining has been retired. Use the Supabase queue workers instead.',
  );
}
