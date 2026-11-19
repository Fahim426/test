import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';
import { Button, Field, Input, Modal } from '@/components/ui';

const schema = z
  .object({ oldPassword: z.string().min(1, 'Required'), newPassword: z.string().min(6, 'At least 6 characters'), confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type Form = z.infer<typeof schema>;

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [err, setErr] = useState('');
  const { register, handleSubmit, reset, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async (v) => {
    setErr('');
    try {
      await api.post('/auth/change-password', { oldPassword: v.oldPassword, newPassword: v.newPassword });
      toast.success('Password changed');
      reset();
      onClose();
    } catch (e) {
      setErr(apiError(e));
    }
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      width="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={formState.isSubmitting} onClick={submit}>
            Change
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Field label="Current password" error={formState.errors.oldPassword?.message}>
          <Input type="password" autoFocus {...register('oldPassword')} />
        </Field>
        <Field label="New password" error={formState.errors.newPassword?.message}>
          <Input type="password" {...register('newPassword')} />
        </Field>
        <Field label="Confirm new password" error={formState.errors.confirm?.message}>
          <Input type="password" {...register('confirm')} />
        </Field>
        {err && <div className="text-[12px] text-red-600">{err}</div>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
