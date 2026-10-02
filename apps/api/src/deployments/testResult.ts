/** The result of "Test connection": each check with a message an admin can act on. */
export type ConnectionCheck = { name: string; ok: boolean; message: string };
export type ConnectionTestResult = { ok: boolean; checks: ConnectionCheck[] };

export const toTestResult = (checks: ConnectionCheck[]): ConnectionTestResult => ({
  ok: checks.length > 0 && checks.every((check) => check.ok),
  checks,
});

/** Runs one check, turning a thrown error into a failed check. */
export const runCheck = async (name: string, check: () => Promise<string>): Promise<ConnectionCheck> => {
  try {
    return { name, ok: true, message: await check() };
  } catch (error) {
    return { name, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
