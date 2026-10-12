import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useResumeSession } from '@/api/auth';
import { settle } from '@/helpers/settle';

const resumeSchema = z.object({ password: z.string().min(1, 'validation.required') });

export type ResumeSessionValues = z.infer<typeof resumeSchema>;

/** The in-place sign-in's password form: signs `email` (the admin already on the page) in again. */
export const useResumeSessionForm = (email: string) => {
  const resume = useResumeSession();
  const form = useForm<ResumeSessionValues>({
    resolver: zodResolver(resumeSchema),
    defaultValues: { password: '' },
  });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    if ((await settle(resume.mutateAsync({ email, password }))).ok) {
      form.reset();
    }
  });
  return { form, onSubmit, resume };
};
