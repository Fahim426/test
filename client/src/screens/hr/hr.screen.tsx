import { RevisionHistory } from '@/components/doc/RevisionHistory';
import { useMemo, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Users, Plus, Save, Trash2, UserCheck, CalendarDays, Briefcase,
  ClipboardList, AlertCircle, CheckCircle2, Clock, TrendingUp,
} from 'lucide-react';
import type { ScreenDef, ScreenProps } from '@/screens/types';
import { Column, DataTable } from '@/components/DataTable';
import { DocumentLayout, HeaderSection, DocSection, DocAction } from '@/components/doc';
import { Button, Field, Input, NumberInput, Select, Textarea, LoadingBlock, ErrorState, StatusBadge, IconButton, ConfirmDialog } from '@/components/ui';
import { useDocument } from '@/hooks/useDocument';
import { useQuery } from '@tanstack/react-query';
import { useOpenScreen, useWorkspace } from '@/store/workspace';
import { usePermission } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import { toast } from '@/store/toast';
import { useMasterRows, useOptions, STATUS_OPTIONS, strOrNull, numOrNull, numOr0 } from '@/components/inventory/common';

const HR = '/hr';
type AnyRec = Record<string, unknown>;

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'PROBATION'];
const GENDER_OPTIONS = ['MALE', 'FEMALE', 'OTHER'];
const EMP_STATUSES = ['ACTIVE', 'RESIGNED', 'TERMINATED', 'ON_LEAVE'];
const LEAVE_TYPES = ['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'PATERNITY', 'EMERGENCY', 'COMPASSIONATE'];
const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const ATT_STATUSES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY'];
const PAYROLL_STATUSES = ['DRAFT', 'PROCESSED', 'PAID'];

const toDate = (v: unknown) => { if (!v) return ''; const s = String(v); return s.length >= 10 ? s.slice(0, 10) : s; };
const fmtLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ════════════════════════════════════════════════════════════════
// EMPLOYEE LIST
// ════════════════════════════════════════════════════════════════

const EmployeeList = ({ tabId: _tabId }: ScreenProps) => {
  const open = useOpenScreen();
  const can = usePermission();
  const [status, setStatus] = useState('');

  const columns: Column<AnyRec>[] = [
    { key: 'employeeNo', header: 'Emp No', width: 100 },
    { key: 'fullName', header: 'Full Name' },
    { key: 'department.name', header: 'Department', sortable: false },
    { key: 'designation.name', header: 'Designation', sortable: false },
    { key: 'employmentType', header: 'Type', width: 110, sortable: false, cell: (r) => <span>{fmtLabel(String(r.employmentType ?? ''))}</span> },
    { key: 'joinDate', header: 'Join Date', type: 'date', width: 100 },
    { key: 'basicSalary', header: 'Basic Salary', type: 'money', width: 120, total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];

  return (
    <DataTable<AnyRec>
      tableKey="hr-employees"
      queryKey="hr-employees"
      columns={columns}
      exportName="Employees"
      searchPlaceholder="Search employee no, name, phone, email..."
      defaultSort={{ key: 'employeeNo', dir: 'asc' }}
      filters={{ status: status || undefined }}
      fetcher={async (p) => {
        const params: AnyRec = { page: p.page, pageSize: p.pageSize };
        if (p.search) params.search = p.search;
        if (p.status) params.status = p.status;
        return (await api.get<never>(`${HR}/employees`, { params })).data;
      }}
      onRowDoubleClick={(r) => open('hr-employee-form', { id: r.id as number }, String(r.fullName ?? r.employeeNo))}
      rowActions={[{ label: 'Open', onClick: (r) => open('hr-employee-form', { id: r.id as number }, String(r.fullName ?? r.employeeNo)) }]}
      toolbarExtras={
        <>
          {can('hr_employees', 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open('hr-employee-form', {}, 'New Employee')}>New Employee</Button>
          )}
          <Select className="w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={STATUS_OPTIONS(EMP_STATUSES)} />
        </>
      }
    />
  );
};

// ════════════════════════════════════════════════════════════════
// EMPLOYEE FORM schema
// ════════════════════════════════════════════════════════════════

const empSchema = z.object({
  firstName: z.string().min(1, 'First name required').max(100),
  lastName: z.string().min(1, 'Last name required').max(100),
  fullName: z.string().min(1, 'Full name required').max(200),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).default('MALE'),
  dob: z.string().nullish(),
  nationality: z.string().max(100).nullish(),
  phone: z.string().max(50).nullish(),
  email: z.string().max(200).nullish(),
  address: z.string().max(500).nullish(),
  departmentId: z.coerce.number().int().positive().nullish(),
  designationId: z.coerce.number().int().positive().nullish(),
  branchId: z.coerce.number().int().positive().nullish(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'PROBATION']).default('FULL_TIME'),
  joinDate: z.string().min(1, 'Join date required'),
  endDate: z.string().nullish(),
  basicSalary: z.coerce.number().min(0).default(0),
  housingAllowance: z.coerce.number().min(0).default(0),
  transportAllowance: z.coerce.number().min(0).default(0),
  otherAllowance: z.coerce.number().min(0).default(0),
  status: z.enum(['ACTIVE', 'RESIGNED', 'TERMINATED', 'ON_LEAVE']).default('ACTIVE'),
  passportNo: z.string().max(50).nullish(),
  passportExpiry: z.string().nullish(),
  visaNo: z.string().max(50).nullish(),
  visaExpiry: z.string().nullish(),
  emiratesId: z.string().max(50).nullish(),
  emiratesExpiry: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
});
type EmpForm = z.infer<typeof empSchema>;

// ════════════════════════════════════════════════════════════════
// EMPLOYEE FORM
// ════════════════════════════════════════════════════════════════

const EmployeeForm = ({ tabId, params }: ScreenProps) => {
  const id = params?.id as number | undefined;
  const can = usePermission();
  const [deleting, setDeleting] = useState(false);

  const doc = useDocument<AnyRec>(`${HR}/employees`, id, {
    tabId,
    titleOf: (d) => String(d.fullName ?? d.employeeNo ?? 'New Employee'),
  });

  const methods = useForm<EmpForm>({
    resolver: zodResolver(empSchema),
    defaultValues: { gender: 'MALE', employmentType: 'FULL_TIME', status: 'ACTIVE', basicSalary: 0, housingAllowance: 0, transportAllowance: 0, otherAllowance: 0 },
  });
  const { register, handleSubmit, reset, watch, formState: { errors, isDirty } } = methods;

  useMemo(() => {
    if (doc.data) {
      const d = doc.data;
      reset({
        firstName: String(d.firstName ?? ''),
        lastName: String(d.lastName ?? ''),
        fullName: String(d.fullName ?? ''),
        gender: (d.gender as EmpForm['gender']) ?? 'MALE',
        dob: toDate(d.dob),
        nationality: strOrNull(d.nationality),
        phone: strOrNull(d.phone),
        email: strOrNull(d.email),
        address: strOrNull(d.address),
        departmentId: numOrNull(d.departmentId),
        designationId: numOrNull(d.designationId),
        branchId: numOrNull(d.branchId),
        employmentType: (d.employmentType as EmpForm['employmentType']) ?? 'FULL_TIME',
        joinDate: toDate(d.joinDate),
        endDate: toDate(d.endDate),
        basicSalary: numOr0(d.basicSalary),
        housingAllowance: numOr0(d.housingAllowance),
        transportAllowance: numOr0(d.transportAllowance),
        otherAllowance: numOr0(d.otherAllowance),
        status: (d.status as EmpForm['status']) ?? 'ACTIVE',
        passportNo: strOrNull(d.passportNo),
        passportExpiry: toDate(d.passportExpiry),
        visaNo: strOrNull(d.visaNo),
        visaExpiry: toDate(d.visaExpiry),
        emiratesId: strOrNull(d.emiratesId),
        emiratesExpiry: toDate(d.emiratesExpiry),
        notes: strOrNull(d.notes),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data]);

  const deptOpts = useOptions(`${HR}/departments`, { pageSize: 500 });
  const desigOpts = useOptions(`${HR}/designations`, { pageSize: 500 });
  const branchOpts = useOptions('/branches', { pageSize: 200 });

  const basic = numOr0(watch('basicSalary'));
  const housing = numOr0(watch('housingAllowance'));
  const transport = numOr0(watch('transportAllowance'));
  const other = numOr0(watch('otherAllowance'));
  const totalSalary = basic + housing + transport + other;

  const onSubmit = handleSubmit(async (vals) => {
    try {
      await doc.save(vals);
      toast.success('Employee saved');
    } catch (e) {
      toast.error(apiError(e));
    }
  });

  const onDelete = async () => {
    try {
      await doc.remove();
      toast.success('Employee deleted');
    } catch (e) {
      toast.error(apiError(e));
    }
    setDeleting(false);
  };

  return (
    <FormProvider {...methods}>
      <DocumentLayout
        title="Employee"
        docNo={doc.data ? String((doc.data as AnyRec).employeeNo ?? '') : undefined}
        status={doc.data ? String((doc.data as AnyRec).status ?? '') : undefined}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            {can('hr_employees', 'create') || can('hr_employees', 'edit') ? (
              <DocAction icon={Save} loading={doc.saving} disabled={!isDirty} onClick={onSubmit}>Save</DocAction>
            ) : null}
            {id && can('hr_employees', 'delete') && (
              <DocAction icon={Trash2} variant="danger" onClick={() => setDeleting(true)}>Delete</DocAction>
            )}
          </>
        }
      >
        <HeaderSection title="Personal Information">
          <div className="grid grid-cols-3 gap-2">
            <Field label="First Name" error={errors.firstName?.message} required>
              <Input {...register('firstName')} />
            </Field>
            <Field label="Last Name" error={errors.lastName?.message} required>
              <Input {...register('lastName')} />
            </Field>
            <Field label="Full Name" error={errors.fullName?.message} required>
              <Input {...register('fullName')} />
            </Field>
            <Field label="Gender">
              <Select {...register('gender')} options={STATUS_OPTIONS(GENDER_OPTIONS)} />
            </Field>
            <Field label="Date of Birth">
              <Input type="date" {...register('dob')} />
            </Field>
            <Field label="Nationality">
              <Input {...register('nationality')} />
            </Field>
            <Field label="Phone">
              <Input {...register('phone')} />
            </Field>
            <Field label="Email">
              <Input type="email" {...register('email')} />
            </Field>
            <Field label="Address" className="col-span-3">
              <Textarea {...register('address')} rows={2} />
            </Field>
          </div>
        </HeaderSection>

        <DocSection title="Employment Details">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Department">
              <Select {...register('departmentId')} options={deptOpts.options} placeholder="Select department" />
            </Field>
            <Field label="Designation">
              <Select {...register('designationId')} options={desigOpts.options} placeholder="Select designation" />
            </Field>
            <Field label="Branch">
              <Select {...register('branchId')} options={branchOpts.options} placeholder="Select branch" />
            </Field>
            <Field label="Employment Type">
              <Select {...register('employmentType')} options={STATUS_OPTIONS(EMPLOYMENT_TYPES)} />
            </Field>
            <Field label="Join Date" error={errors.joinDate?.message} required>
              <Input type="date" {...register('joinDate')} />
            </Field>
            <Field label="End Date">
              <Input type="date" {...register('endDate')} />
            </Field>
            <Field label="Status">
              <Select {...register('status')} options={STATUS_OPTIONS(EMP_STATUSES)} />
            </Field>
          </div>
        </DocSection>

        <DocSection title="Salary">
          <div className="grid grid-cols-4 gap-2">
            <Field label="Basic Salary">
              <NumberInput {...register('basicSalary')} />
            </Field>
            <Field label="Housing Allowance">
              <NumberInput {...register('housingAllowance')} />
            </Field>
            <Field label="Transport Allowance">
              <NumberInput {...register('transportAllowance')} />
            </Field>
            <Field label="Other Allowance">
              <NumberInput {...register('otherAllowance')} />
            </Field>
          </div>
          <div className="mt-1 text-right text-[12px] font-medium text-slate-700">
            Total Package: <span className="font-bold text-brand">{fmt.money(totalSalary)}</span>
          </div>
        </DocSection>

        <DocSection title="Documents & Visa">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Passport No">
              <Input {...register('passportNo')} />
            </Field>
            <Field label="Passport Expiry">
              <Input type="date" {...register('passportExpiry')} />
            </Field>
            <div />
            <Field label="Visa No">
              <Input {...register('visaNo')} />
            </Field>
            <Field label="Visa Expiry">
              <Input type="date" {...register('visaExpiry')} />
            </Field>
            <div />
            <Field label="Emirates ID">
              <Input {...register('emiratesId')} />
            </Field>
            <Field label="Emirates ID Expiry">
              <Input type="date" {...register('emiratesExpiry')} />
            </Field>
          </div>
        </DocSection>

        <DocSection title="Notes">
          <Textarea {...register('notes')} rows={3} />
        </DocSection>
      <RevisionHistory entity="Employee" id={doc.id} />
      </DocumentLayout>

      <ConfirmDialog
        open={deleting}
        danger
        title="Delete Employee"
        message={`Delete ${String((doc.data as AnyRec)?.fullName ?? '')}? This cannot be undone.`}
        onConfirm={onDelete}
        onCancel={() => setDeleting(false)}
      />
    </FormProvider>
  );
};

// ════════════════════════════════════════════════════════════════
// LEAVE REQUESTS
// ════════════════════════════════════════════════════════════════

const LeaveList = ({ tabId: _tabId }: ScreenProps) => {
  const open = useOpenScreen();
  const can = usePermission();
  const [status, setStatus] = useState('');

  const columns: Column<AnyRec>[] = [
    { key: 'employee.employeeNo', header: 'Emp No', width: 90, sortable: false },
    { key: 'employee.fullName', header: 'Employee', sortable: false },
    { key: 'employee.department.name', header: 'Department', sortable: false },
    { key: 'leaveType', header: 'Leave Type', width: 130, sortable: false, cell: (r) => <span>{fmtLabel(String(r.leaveType ?? ''))}</span> },
    { key: 'fromDate', header: 'From', type: 'date', width: 95 },
    { key: 'toDate', header: 'To', type: 'date', width: 95 },
    { key: 'days', header: 'Days', type: 'number', width: 70, total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];

  return (
    <DataTable<AnyRec>
      tableKey="hr-leave"
      queryKey="hr-leave"
      columns={columns}
      exportName="Leave Requests"
      searchPlaceholder="Search employee..."
      defaultSort={{ key: 'createdAt', dir: 'desc' }}
      filters={{ status: status || undefined }}
      fetcher={async (p) => {
        const params: AnyRec = { page: p.page, pageSize: p.pageSize };
        if (p.search) params.search = p.search;
        if (p.status) params.status = p.status;
        return (await api.get<never>(`${HR}/leave`, { params })).data;
      }}
      onRowDoubleClick={(r) => open('hr-leave-form', { id: r.id as number }, String((r.employee as AnyRec | undefined)?.fullName ?? ''))}
      rowActions={[{ label: 'Open', onClick: (r) => open('hr-leave-form', { id: r.id as number }, '') }]}
      toolbarExtras={
        <>
          {can('hr_leave', 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open('hr-leave-form', {}, 'New Leave Request')}>New Request</Button>
          )}
          <Select className="w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={STATUS_OPTIONS(LEAVE_STATUSES)} />
        </>
      }
    />
  );
};

// ── Leave form schema ────────────────────────────────────────────────────────

const leaveSchema = z.object({
  employeeId: z.coerce.number({ required_error: 'Employee required' }).int().positive('Employee required'),
  leaveType: z.enum(['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'PATERNITY', 'EMERGENCY', 'COMPASSIONATE']).default('ANNUAL'),
  fromDate: z.string().min(1, 'From date required'),
  toDate: z.string().min(1, 'To date required'),
  days: z.coerce.number().min(0.5).default(1),
  reason: z.string().max(2000).nullish(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).default('PENDING'),
  remarks: z.string().max(500).nullish(),
});
type LeaveForm = z.infer<typeof leaveSchema>;

const LeaveRequestForm = ({ tabId, params }: ScreenProps) => {
  const id = params?.id as number | undefined;
  const can = usePermission();
  const [deleting, setDeleting] = useState(false);

  const doc = useDocument<AnyRec>(`${HR}/leave`, id, { tabId });

  const methods = useForm<LeaveForm>({
    resolver: zodResolver(leaveSchema),
    defaultValues: { leaveType: 'ANNUAL', days: 1, status: 'PENDING' },
  });
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = methods;

  useMemo(() => {
    if (doc.data) {
      const d = doc.data;
      reset({
        employeeId: d.employeeId as number,
        leaveType: (d.leaveType as LeaveForm['leaveType']) ?? 'ANNUAL',
        fromDate: toDate(d.fromDate),
        toDate: toDate(d.toDate),
        days: numOr0(d.days) || 1,
        reason: strOrNull(d.reason),
        status: (d.status as LeaveForm['status']) ?? 'PENDING',
        remarks: strOrNull(d.remarks),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data]);

  const empOpts = useOptions(`${HR}/employees`, { status: 'ACTIVE', pageSize: 500 });

  const onSubmit = handleSubmit(async (vals) => {
    try { await doc.save(vals); toast.success('Leave request saved'); }
    catch (e) { toast.error(apiError(e)); }
  });

  const approve = async () => {
    if (!id) return;
    try {
      await api.post(`${HR}/leave/${id}/approve`);
      doc.refetch();
      toast.success('Leave approved');
    } catch (e) { toast.error(apiError(e)); }
  };

  const reject = async () => {
    if (!id) return;
    try {
      await api.post(`${HR}/leave/${id}/reject`);
      doc.refetch();
      toast.success('Leave rejected');
    } catch (e) { toast.error(apiError(e)); }
  };

  const status = String((doc.data as AnyRec)?.status ?? 'PENDING');

  return (
    <FormProvider {...methods}>
      <DocumentLayout
        title="Leave Request"
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            {(can('hr_leave', 'create') || can('hr_leave', 'edit')) && (
              <DocAction icon={Save} loading={doc.saving} disabled={!isDirty} onClick={onSubmit}>Save</DocAction>
            )}
            {id && status === 'PENDING' && can('hr_leave', 'approve') && (
              <DocAction icon={CheckCircle2} variant="primary" onClick={approve}>Approve</DocAction>
            )}
            {id && status === 'PENDING' && can('hr_leave', 'reject') && (
              <DocAction icon={AlertCircle} variant="danger" onClick={reject}>Reject</DocAction>
            )}
            {id && can('hr_leave', 'delete') && (
              <DocAction icon={Trash2} variant="danger" onClick={() => setDeleting(true)}>Delete</DocAction>
            )}
          </>
        }
      >
        <HeaderSection title="Leave Details">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Employee" error={errors.employeeId?.message} required>
              <Select {...register('employeeId')} options={empOpts.options} placeholder="Select employee" />
            </Field>
            <Field label="Leave Type">
              <Select {...register('leaveType')} options={STATUS_OPTIONS(LEAVE_TYPES)} />
            </Field>
            <Field label="Status">
              <Select {...register('status')} options={STATUS_OPTIONS(LEAVE_STATUSES)} />
            </Field>
            <Field label="From Date" error={errors.fromDate?.message} required>
              <Input type="date" {...register('fromDate')} />
            </Field>
            <Field label="To Date" error={errors.toDate?.message} required>
              <Input type="date" {...register('toDate')} />
            </Field>
            <Field label="Days">
              <NumberInput {...register('days')} />
            </Field>
            <Field label="Reason" className="col-span-3">
              <Textarea {...register('reason')} rows={2} />
            </Field>
            <Field label="Remarks" className="col-span-3">
              <Input {...register('remarks')} />
            </Field>
          </div>
        </HeaderSection>
      <RevisionHistory entity="LeaveRequest" id={doc.id} />
      </DocumentLayout>
      <ConfirmDialog
        open={deleting}
        danger
        title="Delete Leave Request"
        message="Delete this leave request? This cannot be undone."
        onConfirm={async () => { try { await doc.remove(); } catch (e) { toast.error(apiError(e)); } setDeleting(false); }}
        onCancel={() => setDeleting(false)}
      />
    </FormProvider>
  );
};

// ════════════════════════════════════════════════════════════════
// ATTENDANCE
// ════════════════════════════════════════════════════════════════

const AttendanceList = ({ tabId: _tabId }: ScreenProps) => {
  const [status, setStatus] = useState('');

  const columns: Column<AnyRec>[] = [
    { key: 'employee.employeeNo', header: 'Emp No', width: 90, sortable: false },
    { key: 'employee.fullName', header: 'Employee', sortable: false },
    { key: 'attendanceDate', header: 'Date', type: 'date', width: 100 },
    { key: 'checkIn', header: 'Check In', width: 90, sortable: false, cell: (r) => <span>{r.checkIn ? String(r.checkIn).slice(11, 16) : '—'}</span> },
    { key: 'checkOut', header: 'Check Out', width: 90, sortable: false, cell: (r) => <span>{r.checkOut ? String(r.checkOut).slice(11, 16) : '—'}</span> },
    { key: 'hoursWorked', header: 'Hours', type: 'qty', width: 80, total: 'sum' },
    { key: 'overtimeHours', header: 'OT Hours', type: 'qty', width: 80, total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];

  return (
    <DataTable<AnyRec>
      tableKey="hr-attendance"
      queryKey="hr-attendance"
      columns={columns}
      exportName="Attendance"
      searchPlaceholder="Search employee..."
      defaultSort={{ key: 'attendanceDate', dir: 'desc' }}
      filters={{ status: status || undefined }}
      fetcher={async (p) => {
        const params: AnyRec = { page: p.page, pageSize: p.pageSize };
        if (p.search) params.search = p.search;
        if (p.status) params.status = p.status;
        return (await api.get<never>(`${HR}/attendance`, { params })).data;
      }}
      toolbarExtras={
        <Select className="w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={STATUS_OPTIONS(ATT_STATUSES)} />
      }
    />
  );
};

// ════════════════════════════════════════════════════════════════
// PAYROLL LIST
// ════════════════════════════════════════════════════════════════

const PayrollList = ({ tabId: _tabId }: ScreenProps) => {
  const open = useOpenScreen();
  const can = usePermission();
  const [status, setStatus] = useState('');

  const columns: Column<AnyRec>[] = [
    { key: 'payrollNo', header: 'Payroll No', width: 110 },
    { key: 'employee.fullName', header: 'Employee', sortable: false },
    { key: 'employee.department.name', header: 'Department', sortable: false },
    { key: 'employee.designation.name', header: 'Designation', sortable: false },
    { key: 'periodFrom', header: 'Period From', type: 'date', width: 100 },
    { key: 'periodTo', header: 'Period To', type: 'date', width: 100 },
    { key: 'grossSalary', header: 'Gross', type: 'money', width: 110, total: 'sum' },
    { key: 'deductions', header: 'Deductions', type: 'money', width: 110, total: 'sum' },
    { key: 'netSalary', header: 'Net Pay', type: 'money', width: 110, total: 'sum' },
    { key: 'status', header: 'Status', type: 'status', width: 110 },
  ];

  return (
    <DataTable<AnyRec>
      tableKey="hr-payroll"
      queryKey="hr-payroll"
      columns={columns}
      exportName="Payroll"
      searchPlaceholder="Search employee..."
      defaultSort={{ key: 'createdAt', dir: 'desc' }}
      filters={{ status: status || undefined }}
      fetcher={async (p) => {
        const params: AnyRec = { page: p.page, pageSize: p.pageSize };
        if (p.search) params.search = p.search;
        if (p.status) params.status = p.status;
        return (await api.get<never>(`${HR}/payroll`, { params })).data;
      }}
      onRowDoubleClick={(r) => open('hr-payroll-form', { id: r.id as number }, String(r.payrollNo ?? ''))}
      rowActions={[{ label: 'Open', onClick: (r) => open('hr-payroll-form', { id: r.id as number }, String(r.payrollNo ?? '')) }]}
      toolbarExtras={
        <>
          {can('hr_payroll', 'create') && (
            <Button variant="primary" icon={Plus} onClick={() => open('hr-payroll-form', {}, 'New Payroll')}>New Payroll</Button>
          )}
          <Select className="w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={STATUS_OPTIONS(PAYROLL_STATUSES)} />
        </>
      }
    />
  );
};

// ── Payroll form schema ──────────────────────────────────────────────────────

const payrollSchema = z.object({
  employeeId: z.coerce.number({ required_error: 'Employee required' }).int().positive('Employee required'),
  periodFrom: z.string().min(1, 'Period from required'),
  periodTo: z.string().min(1, 'Period to required'),
  basicSalary: z.coerce.number().min(0).default(0),
  housingAllowance: z.coerce.number().min(0).default(0),
  transportAllowance: z.coerce.number().min(0).default(0),
  otherAllowance: z.coerce.number().min(0).default(0),
  overtimePay: z.coerce.number().min(0).default(0),
  deductions: z.coerce.number().min(0).default(0),
  daysWorked: z.coerce.number().min(0).default(0),
  daysAbsent: z.coerce.number().min(0).default(0),
  overtimeHours: z.coerce.number().min(0).default(0),
  notes: z.string().max(2000).nullish(),
  status: z.enum(['DRAFT', 'PROCESSED', 'PAID']).default('DRAFT'),
});
type PayrollForm = z.infer<typeof payrollSchema>;

const PayrollFormScreen = ({ tabId, params }: ScreenProps) => {
  const id = params?.id as number | undefined;
  const can = usePermission();
  const [deleting, setDeleting] = useState(false);

  const doc = useDocument<AnyRec>(`${HR}/payroll`, id, {
    tabId,
    titleOf: (d) => String(d.payrollNo ?? 'New Payroll'),
  });

  const methods = useForm<PayrollForm>({
    resolver: zodResolver(payrollSchema),
    defaultValues: { status: 'DRAFT', basicSalary: 0, housingAllowance: 0, transportAllowance: 0, otherAllowance: 0, overtimePay: 0, deductions: 0, daysWorked: 0, daysAbsent: 0, overtimeHours: 0 },
  });
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isDirty } } = methods;

  useMemo(() => {
    if (doc.data) {
      const d = doc.data;
      reset({
        employeeId: d.employeeId as number,
        periodFrom: toDate(d.periodFrom),
        periodTo: toDate(d.periodTo),
        basicSalary: numOr0(d.basicSalary),
        housingAllowance: numOr0(d.housingAllowance),
        transportAllowance: numOr0(d.transportAllowance),
        otherAllowance: numOr0(d.otherAllowance),
        overtimePay: numOr0(d.overtimePay),
        deductions: numOr0(d.deductions),
        daysWorked: numOr0(d.daysWorked),
        daysAbsent: numOr0(d.daysAbsent),
        overtimeHours: numOr0(d.overtimeHours),
        notes: strOrNull(d.notes),
        status: (d.status as PayrollForm['status']) ?? 'DRAFT',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.data]);

  const empOpts = useOptions(`${HR}/employees`, { pageSize: 500 });

  // Auto-fill salary from employee record when employee changes
  const selectedEmpId = watch('employeeId');
  const { data: empRows } = useMasterRows(`${HR}/employees`, { pageSize: 500 });
  useMemo(() => {
    if (!selectedEmpId || doc.data?.employeeId === selectedEmpId) return;
    const emp = empRows?.find((e) => e.id === Number(selectedEmpId));
    if (emp) {
      setValue('basicSalary', numOr0(emp.basicSalary));
      setValue('housingAllowance', numOr0(emp.housingAllowance));
      setValue('transportAllowance', numOr0(emp.transportAllowance));
      setValue('otherAllowance', numOr0(emp.otherAllowance));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpId]);

  const basic = numOr0(watch('basicSalary'));
  const housing = numOr0(watch('housingAllowance'));
  const transport = numOr0(watch('transportAllowance'));
  const other = numOr0(watch('otherAllowance'));
  const overtime = numOr0(watch('overtimePay'));
  const deductions = numOr0(watch('deductions'));
  const gross = basic + housing + transport + other + overtime;
  const net = gross - deductions;

  const onSubmit = handleSubmit(async (vals) => {
    try { await doc.save(vals); toast.success('Payroll saved'); }
    catch (e) { toast.error(apiError(e)); }
  });

  const process = async () => {
    if (!id) return;
    try { await api.post(`${HR}/payroll/${id}/process`); doc.refetch(); toast.success('Payroll processed'); }
    catch (e) { toast.error(apiError(e)); }
  };

  const markPaid = async () => {
    if (!id) return;
    try { await api.post(`${HR}/payroll/${id}/pay`); doc.refetch(); toast.success('Payroll marked as PAID'); }
    catch (e) { toast.error(apiError(e)); }
  };

  const status = String((doc.data as AnyRec)?.status ?? 'DRAFT');

  return (
    <FormProvider {...methods}>
      <DocumentLayout
        title="Payroll"
        docNo={doc.data ? String((doc.data as AnyRec).payrollNo ?? '') : undefined}
        status={status}
        loading={doc.isLoading}
        error={doc.error}
        actions={
          <>
            {(can('hr_payroll', 'create') || can('hr_payroll', 'edit')) && status === 'DRAFT' && (
              <DocAction icon={Save} loading={doc.saving} disabled={!isDirty} onClick={onSubmit}>Save</DocAction>
            )}
            {id && status === 'DRAFT' && can('hr_payroll', 'approve') && (
              <DocAction icon={CheckCircle2} variant="primary" onClick={process}>Process</DocAction>
            )}
            {id && status === 'PROCESSED' && can('hr_payroll', 'approve') && (
              <DocAction icon={Briefcase} variant="primary" onClick={markPaid}>Mark Paid</DocAction>
            )}
            {id && status === 'DRAFT' && can('hr_payroll', 'delete') && (
              <DocAction icon={Trash2} variant="danger" onClick={() => setDeleting(true)}>Delete</DocAction>
            )}
          </>
        }
      >
        <HeaderSection title="Payroll Details">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Employee" error={errors.employeeId?.message} required>
              <Select {...register('employeeId')} options={empOpts.options} placeholder="Select employee" disabled={!!id} />
            </Field>
            <Field label="Period From" error={errors.periodFrom?.message} required>
              <Input type="date" {...register('periodFrom')} />
            </Field>
            <Field label="Period To" error={errors.periodTo?.message} required>
              <Input type="date" {...register('periodTo')} />
            </Field>
            <Field label="Status">
              <Select {...register('status')} options={STATUS_OPTIONS(PAYROLL_STATUSES)} disabled />
            </Field>
            <Field label="Days Worked">
              <NumberInput {...register('daysWorked')} />
            </Field>
            <Field label="Days Absent">
              <NumberInput {...register('daysAbsent')} />
            </Field>
          </div>
        </HeaderSection>

        <DocSection title="Earnings">
          <div className="grid grid-cols-4 gap-2">
            <Field label="Basic Salary">
              <NumberInput {...register('basicSalary')} />
            </Field>
            <Field label="Housing Allowance">
              <NumberInput {...register('housingAllowance')} />
            </Field>
            <Field label="Transport Allowance">
              <NumberInput {...register('transportAllowance')} />
            </Field>
            <Field label="Other Allowance">
              <NumberInput {...register('otherAllowance')} />
            </Field>
            <Field label="Overtime Hours">
              <NumberInput {...register('overtimeHours')} />
            </Field>
            <Field label="Overtime Pay">
              <NumberInput {...register('overtimePay')} />
            </Field>
          </div>
        </DocSection>

        <DocSection
          title="Summary"
          right={
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[12px]">
              <span className="text-slate-500">Gross Salary</span><span className="text-right font-medium">{fmt.money(gross)}</span>
              <span className="text-slate-500">Deductions</span><span className="text-right font-medium">{fmt.money(deductions)}</span>
              <span className="font-semibold text-slate-700">Net Pay</span><span className="text-right font-bold text-brand text-[14px]">{fmt.money(net)}</span>
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Deductions">
              <NumberInput {...register('deductions')} />
            </Field>
            <Field label="Notes">
              <Input {...register('notes')} />
            </Field>
          </div>
        </DocSection>
      <RevisionHistory entity="Payroll" id={doc.id} />
      </DocumentLayout>

      <ConfirmDialog
        open={deleting}
        danger
        title="Delete Payroll"
        message="Delete this payroll record? This cannot be undone."
        onConfirm={async () => { try { await doc.remove(); } catch (e) { toast.error(apiError(e)); } setDeleting(false); }}
        onCancel={() => setDeleting(false)}
      />
    </FormProvider>
  );
};

// ════════════════════════════════════════════════════════════════
// HR DASHBOARD / REPORTS
// ════════════════════════════════════════════════════════════════

const HrDashboard = (_props: ScreenProps) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['hr', 'summary'],
    queryFn: async () => (await api.get<AnyRec>(`${HR}/summary`)).data,
    staleTime: 60_000,
  });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorState message={apiError(error)} onRetry={refetch} />;

  const tiles = [
    { label: 'Total Employees', value: data?.totalEmployees, icon: Users, color: 'text-brand' },
    { label: 'Active Employees', value: data?.activeEmployees, icon: UserCheck, color: 'text-green-600' },
    { label: 'Pending Leave', value: data?.pendingLeave, icon: CalendarDays, color: 'text-amber-600' },
    { label: 'Draft Payroll', value: data?.draftPayroll, icon: Briefcase, color: 'text-blue-600' },
    { label: 'Expiring Documents', value: data?.expiringDocs, icon: AlertCircle, color: 'text-red-600' },
  ];

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-[14px] font-semibold text-slate-700">HR Overview</h2>
      <div className="grid grid-cols-5 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded border border-app-border bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <t.icon size={16} className={t.color} />
              <span className="text-[11px] text-slate-500">{t.label}</span>
            </div>
            <div className={`text-[22px] font-bold ${t.color}`}>{String(t.value ?? 0)}</div>
          </div>
        ))}
      </div>
      {Number(data?.expiringDocs) > 0 && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 flex items-center gap-2">
          <AlertCircle size={14} />
          {Number(data?.expiringDocs)} employee(s) have passport, visa or Emirates ID expiring within 30 days.
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MASTERS: Departments & Designations
// ════════════════════════════════════════════════════════════════

const DepartmentList = (_props: ScreenProps) => {
  const [editing, setEditing] = useState<AnyRec | null>(null);
  const [form, setForm] = useState({ code: '', name: '' });
  const can = usePermission();

  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ['hr-depts'],
    queryFn: async () => (await api.get<{ rows: AnyRec[] }>(`${HR}/departments`, { params: { pageSize: 500 } })).data.rows ?? [],
  });

  const save = async () => {
    try {
      if (editing?.id) {
        await api.put(`${HR}/departments/${editing.id}`, { ...form, isActive: true });
      } else {
        await api.post(`${HR}/departments`, { ...form, isActive: true });
      }
      toast.success('Saved');
      setEditing(null);
      setForm({ code: '', name: '' });
      refetch();
    } catch (e) { toast.error(apiError(e)); }
  };

  const del = async (id: number) => {
    try { await api.delete(`${HR}/departments/${id}`); refetch(); toast.success('Deleted'); }
    catch (e) { toast.error(apiError(e)); }
  };

  const startEdit = (r: AnyRec) => { setEditing(r); setForm({ code: String(r.code ?? ''), name: String(r.name ?? '') }); };
  const startNew = () => { setEditing({}); setForm({ code: '', name: '' }); };

  if (isLoading) return <LoadingBlock />;

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-slate-700">Departments</span>
        {can('hr_employees', 'create') && <Button size="sm" icon={Plus} onClick={startNew}>New</Button>}
      </div>
      {editing !== null && (
        <div className="rounded border border-app-border bg-white p-2 flex gap-2 items-end">
          <Field label="Code"><Input className="w-24" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} /></Field>
          <Field label="Name"><Input className="w-56" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
          <Button variant="primary" icon={Save} onClick={save}>Save</Button>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      )}
      <table className="w-full text-[12px] border border-app-border bg-white">
        <thead><tr className="bg-brand-light text-left"><th className="px-2 py-1 w-24">Code</th><th className="px-2 py-1">Name</th><th className="px-2 py-1 w-16"></th></tr></thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id as number} className="border-t border-app-border hover:bg-brand-light/40">
              <td className="px-2 py-1 font-mono">{String(r.code ?? '')}</td>
              <td className="px-2 py-1">{String(r.name ?? '')}</td>
              <td className="px-2 py-1 flex gap-1">
                {can('hr_employees', 'edit') && <IconButton icon={Save} label="Edit" onClick={() => startEdit(r)} />}
                {can('hr_employees', 'delete') && <IconButton icon={Trash2} variant="danger" label="Delete" onClick={() => del(r.id as number)} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const DesignationList = (_props: ScreenProps) => {
  const [editing, setEditing] = useState<AnyRec | null>(null);
  const [form, setForm] = useState({ code: '', name: '' });
  const can = usePermission();

  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ['hr-desigs'],
    queryFn: async () => (await api.get<{ rows: AnyRec[] }>(`${HR}/designations`, { params: { pageSize: 500 } })).data.rows ?? [],
  });

  const save = async () => {
    try {
      if (editing?.id) {
        await api.put(`${HR}/designations/${editing.id}`, { ...form, isActive: true });
      } else {
        await api.post(`${HR}/designations`, { ...form, isActive: true });
      }
      toast.success('Saved');
      setEditing(null);
      setForm({ code: '', name: '' });
      refetch();
    } catch (e) { toast.error(apiError(e)); }
  };

  const del = async (id: number) => {
    try { await api.delete(`${HR}/designations/${id}`); refetch(); toast.success('Deleted'); }
    catch (e) { toast.error(apiError(e)); }
  };

  const startEdit = (r: AnyRec) => { setEditing(r); setForm({ code: String(r.code ?? ''), name: String(r.name ?? '') }); };

  if (isLoading) return <LoadingBlock />;

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-slate-700">Designations</span>
        {can('hr_employees', 'create') && <Button size="sm" icon={Plus} onClick={() => { setEditing({}); setForm({ code: '', name: '' }); }}>New</Button>}
      </div>
      {editing !== null && (
        <div className="rounded border border-app-border bg-white p-2 flex gap-2 items-end">
          <Field label="Code"><Input className="w-24" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} /></Field>
          <Field label="Name"><Input className="w-56" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
          <Button variant="primary" icon={Save} onClick={save}>Save</Button>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      )}
      <table className="w-full text-[12px] border border-app-border bg-white">
        <thead><tr className="bg-brand-light text-left"><th className="px-2 py-1 w-24">Code</th><th className="px-2 py-1">Name</th><th className="px-2 py-1 w-16"></th></tr></thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id as number} className="border-t border-app-border hover:bg-brand-light/40">
              <td className="px-2 py-1 font-mono">{String(r.code ?? '')}</td>
              <td className="px-2 py-1">{String(r.name ?? '')}</td>
              <td className="px-2 py-1 flex gap-1">
                {can('hr_employees', 'edit') && <IconButton icon={Save} label="Edit" onClick={() => startEdit(r)} />}
                {can('hr_employees', 'delete') && <IconButton icon={Trash2} variant="danger" label="Delete" onClick={() => del(r.id as number)} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// SCREEN EXPORTS
// ════════════════════════════════════════════════════════════════

export default [
  { id: 'hr-dashboard', title: 'HR Dashboard', component: HrDashboard, permission: 'hr_employees' },
  { id: 'hr-employees', title: 'Employees', component: EmployeeList, permission: 'hr_employees' },
  { id: 'hr-employee-form', title: 'Employee', component: EmployeeForm, permission: 'hr_employees' },
  { id: 'hr-leave', title: 'Leave Requests', component: LeaveList, permission: 'hr_leave' },
  { id: 'hr-leave-form', title: 'Leave Request', component: LeaveRequestForm, permission: 'hr_leave' },
  { id: 'hr-attendance', title: 'Attendance', component: AttendanceList, permission: 'hr_attendance' },
  { id: 'hr-payroll', title: 'Payroll', component: PayrollList, permission: 'hr_payroll' },
  { id: 'hr-payroll-form', title: 'Payroll', component: PayrollFormScreen, permission: 'hr_payroll' },
  { id: 'hr-departments', title: 'Departments', component: DepartmentList, permission: 'hr_employees' },
  { id: 'hr-designations', title: 'Designations', component: DesignationList, permission: 'hr_employees' },
] satisfies ScreenDef[];
