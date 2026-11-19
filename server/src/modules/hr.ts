import { revisionSnapshot, auditRevision } from '../services/revisions-history';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, intParam, listQuery, paged, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { can } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/numbering';
import type { ModuleDef } from '../app';

const router = Router();
const num = (v: unknown) => Number(v ?? 0);

// ── Helpers ─────────────────────────────────────────────────────────────────

const optStr = z.string().trim().nullish();
const optInt = z.coerce.number().int().positive().nullish();
const optDate = z.string().nullish();
const optDec = z.coerce.number().min(0).default(0);

// ── Schemas ──────────────────────────────────────────────────────────────────

const deptSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  managerId: optInt,
  isActive: z.boolean().default(true),
});

const desigSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  isActive: z.boolean().default(true),
});

const employeeSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  fullName: z.string().trim().min(1).max(200),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).default('MALE'),
  dob: optDate,
  nationality: optStr,
  phone: optStr,
  email: optStr,
  address: optStr,
  departmentId: optInt,
  designationId: optInt,
  branchId: optInt,
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'PROBATION']).default('FULL_TIME'),
  joinDate: z.string().min(1, 'Join date required'),
  endDate: optDate,
  basicSalary: optDec,
  housingAllowance: optDec,
  transportAllowance: optDec,
  otherAllowance: optDec,
  status: z.enum(['ACTIVE', 'RESIGNED', 'TERMINATED', 'ON_LEAVE']).default('ACTIVE'),
  passportNo: optStr,
  passportExpiry: optDate,
  visaNo: optStr,
  visaExpiry: optDate,
  emiratesId: optStr,
  emiratesExpiry: optDate,
  notes: optStr,
});

const attendanceSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  attendanceDate: z.string().min(1),
  checkIn: optDate,
  checkOut: optDate,
  hoursWorked: optDec,
  overtimeHours: optDec,
  status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY']).default('PRESENT'),
  remarks: optStr,
});

const leaveSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  leaveType: z.enum(['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'PATERNITY', 'EMERGENCY', 'COMPASSIONATE']).default('ANNUAL'),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  days: z.coerce.number().min(0.5).default(1),
  reason: optStr,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).default('PENDING'),
  remarks: optStr,
});

const payrollSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  periodFrom: z.string().min(1),
  periodTo: z.string().min(1),
  basicSalary: optDec,
  housingAllowance: optDec,
  transportAllowance: optDec,
  otherAllowance: optDec,
  overtimePay: optDec,
  deductions: optDec,
  daysWorked: optDec,
  daysAbsent: optDec,
  overtimeHours: optDec,
  notes: optStr,
  status: z.enum(['DRAFT', 'PROCESSED', 'PAID']).default('DRAFT'),
});

// ════════════════════════════════════════════════════════════════
// DEPARTMENTS
// ════════════════════════════════════════════════════════════════

router.get('/departments', can('hr_employees', 'view'), ah(async (req, res) => {
  const q = listQuery(req);
  const where = q.search ? { OR: [{ name: { contains: q.search } }, { code: { contains: q.search } }] } : {};
  const [rows, total] = await Promise.all([
    prisma.department.findMany({ where, orderBy: { code: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.department.count({ where }),
  ]);
  res.json(paged(rows, total, q));
}));

router.get('/departments/:id', can('hr_employees', 'view'), ah(async (req, res) => {
  const row = await prisma.department.findUnique({ where: { id: intParam(req) } });
  if (!row) throw notFound();
  res.json(row);
}));

router.post('/departments', can('hr_employees', 'create'), ah(async (req, res) => {
  const data = parse(deptSchema, req.body);
  const row = await prisma.department.create({ data });
  res.status(201).json(row);
}));

router.put('/departments/:id', can('hr_employees', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  if (!await prisma.department.findUnique({ where: { id } })) throw notFound();
  const data = parse(deptSchema, req.body);
  res.json(await prisma.department.update({ where: { id }, data }));
}));

router.delete('/departments/:id', can('hr_employees', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  if (!await prisma.department.findUnique({ where: { id } })) throw notFound();
  if (await prisma.employee.count({ where: { departmentId: id } })) throw badRequest('Department has employees; cannot delete.');
  await prisma.department.delete({ where: { id } });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════
// DESIGNATIONS
// ════════════════════════════════════════════════════════════════

router.get('/designations', can('hr_employees', 'view'), ah(async (req, res) => {
  const q = listQuery(req);
  const where = q.search ? { OR: [{ name: { contains: q.search } }, { code: { contains: q.search } }] } : {};
  const [rows, total] = await Promise.all([
    prisma.designation.findMany({ where, orderBy: { code: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.designation.count({ where }),
  ]);
  res.json(paged(rows, total, q));
}));

router.get('/designations/:id', can('hr_employees', 'view'), ah(async (req, res) => {
  const row = await prisma.designation.findUnique({ where: { id: intParam(req) } });
  if (!row) throw notFound();
  res.json(row);
}));

router.post('/designations', can('hr_employees', 'create'), ah(async (req, res) => {
  const data = parse(desigSchema, req.body);
  const row = await prisma.designation.create({ data });
  res.status(201).json(row);
}));

router.put('/designations/:id', can('hr_employees', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  if (!await prisma.designation.findUnique({ where: { id } })) throw notFound();
  const data = parse(desigSchema, req.body);
  res.json(await prisma.designation.update({ where: { id }, data }));
}));

router.delete('/designations/:id', can('hr_employees', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  if (!await prisma.designation.findUnique({ where: { id } })) throw notFound();
  if (await prisma.employee.count({ where: { designationId: id } })) throw badRequest('Designation has employees; cannot delete.');
  await prisma.designation.delete({ where: { id } });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════
// EMPLOYEES
// ════════════════════════════════════════════════════════════════

const empInclude = {
  department: { select: { id: true, code: true, name: true } },
  designation: { select: { id: true, code: true, name: true } },
};

router.get('/employees', can('hr_employees', 'view'), ah(async (req, res) => {
  const q = listQuery(req);
  const where: Record<string, unknown> = {};
  if (q.search) {
    where.OR = [
      { employeeNo: { contains: q.search } },
      { fullName: { contains: q.search } },
      { phone: { contains: q.search } },
      { email: { contains: q.search } },
    ];
  }
  if (req.query.status) where.status = req.query.status;
  if (req.query.departmentId) where.departmentId = Number(req.query.departmentId);
  const [rows, total] = await Promise.all([
    prisma.employee.findMany({ where, include: empInclude, orderBy: { employeeNo: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.employee.count({ where }),
  ]);
  res.json(paged(rows, total, q));
}));

router.get('/employees/:id', can('hr_employees', 'view'), ah(async (req, res) => {
  const row = await prisma.employee.findUnique({ where: { id: intParam(req) }, include: empInclude });
  if (!row) throw notFound();
  res.json(row);
}));

router.post('/employees', can('hr_employees', 'create'), ah(async (req, res) => {
  const data = parse(employeeSchema, req.body);
  const row = await prisma.$transaction(async (tx) => {
    const employeeNo = await nextNumber(tx, 'EMPLOYEE', { date: new Date(data.joinDate) });
    return tx.employee.create({
      data: {
        ...data,
        employeeNo,
        joinDate: new Date(data.joinDate),
        dob: data.dob ? new Date(data.dob) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        passportExpiry: data.passportExpiry ? new Date(data.passportExpiry) : null,
        visaExpiry: data.visaExpiry ? new Date(data.visaExpiry) : null,
        emiratesExpiry: data.emiratesExpiry ? new Date(data.emiratesExpiry) : null,
        createdBy: req.user?.id,
      },
      include: empInclude,
    });
  });
  await audit(prisma, req.user, 'CREATE', 'employee', row.id, { employeeNo: row.employeeNo });
  res.status(201).json(row);
}));

router.put('/employees/:id', can('hr_employees', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const row = await prisma.$transaction(async tx => {
    const before = await revisionSnapshot(tx, 'Employee', id);
  if (!await tx.employee.findUnique({ where: { id } })) throw notFound();
  const data = parse(employeeSchema, req.body);
  const row = await tx.employee.update({
    where: { id },
    data: {
      ...data,
      joinDate: new Date(data.joinDate),
      dob: data.dob ? new Date(data.dob) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      passportExpiry: data.passportExpiry ? new Date(data.passportExpiry) : null,
      visaExpiry: data.visaExpiry ? new Date(data.visaExpiry) : null,
      emiratesExpiry: data.emiratesExpiry ? new Date(data.emiratesExpiry) : null,
    },
    include: empInclude,
  });
  await audit(tx, req.user, 'UPDATE', 'employee', id, { employeeNo: row.employeeNo });
    await auditRevision(tx, req.user, 'Employee', id, before, req.body?.changeReason);
    return row;
  }, { timeout: 30000 });
  res.json(row);
}));

router.delete('/employees/:id', can('hr_employees', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) throw notFound();
  if (emp.status === 'ACTIVE') throw badRequest('Cannot delete an ACTIVE employee. Change status first.');
  await prisma.employee.delete({ where: { id } });
  await audit(prisma, req.user, 'DELETE', 'employee', id, { employeeNo: emp.employeeNo });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════
// ATTENDANCE
// ════════════════════════════════════════════════════════════════

router.get('/attendance', can('hr_attendance', 'view'), ah(async (req, res) => {
  const q = listQuery(req);
  const where: Record<string, unknown> = {};
  if (req.query.employeeId) where.employeeId = Number(req.query.employeeId);
  if (req.query.from) where.attendanceDate = { gte: new Date(String(req.query.from)) };
  if (req.query.from && req.query.to) where.attendanceDate = { gte: new Date(String(req.query.from)), lte: new Date(String(req.query.to)) };
  if (req.query.status) where.status = req.query.status;
  const [rows, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
      orderBy: [{ attendanceDate: 'desc' }, { employee: { employeeNo: 'asc' } }],
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
    prisma.attendance.count({ where }),
  ]);
  res.json(paged(rows, total, q));
}));

router.post('/attendance', can('hr_attendance', 'create'), ah(async (req, res) => {
  const data = parse(attendanceSchema, req.body);
  if (!await prisma.employee.findUnique({ where: { id: data.employeeId } })) throw notFound('Employee not found');
  const existing = await prisma.attendance.findUnique({ where: { employeeId_attendanceDate: { employeeId: data.employeeId, attendanceDate: new Date(data.attendanceDate) } } });
  if (existing) throw badRequest('Attendance already recorded for this employee on this date');
  const row = await prisma.attendance.create({
    data: {
      ...data,
      attendanceDate: new Date(data.attendanceDate),
      checkIn: data.checkIn ? new Date(data.checkIn) : null,
      checkOut: data.checkOut ? new Date(data.checkOut) : null,
    },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
  });
  res.status(201).json(row);
}));

router.put('/attendance/:id', can('hr_attendance', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const row = await prisma.$transaction(async tx => {
    const before = await revisionSnapshot(tx, 'Attendance', id);
  if (!await tx.attendance.findUnique({ where: { id } })) throw notFound();
  const data = parse(attendanceSchema, req.body);
  const row = await tx.attendance.update({
    where: { id },
    data: {
      ...data,
      attendanceDate: new Date(data.attendanceDate),
      checkIn: data.checkIn ? new Date(data.checkIn) : null,
      checkOut: data.checkOut ? new Date(data.checkOut) : null,
    },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
  });
    await auditRevision(tx, req.user, 'Attendance', id, before, req.body?.changeReason);
    return row;
  }, { timeout: 30000 });
  res.json(row);
}));

router.delete('/attendance/:id', can('hr_attendance', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  if (!await prisma.attendance.findUnique({ where: { id } })) throw notFound();
  await prisma.attendance.delete({ where: { id } });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════
// LEAVE REQUESTS
// ════════════════════════════════════════════════════════════════

router.get('/leave', can('hr_leave', 'view'), ah(async (req, res) => {
  const q = listQuery(req);
  const where: Record<string, unknown> = {};
  if (req.query.employeeId) where.employeeId = Number(req.query.employeeId);
  if (req.query.status) where.status = req.query.status;
  if (req.query.leaveType) where.leaveType = req.query.leaveType;
  const [rows, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      include: { employee: { select: { id: true, employeeNo: true, fullName: true, departmentId: true, department: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
    prisma.leaveRequest.count({ where }),
  ]);
  res.json(paged(rows, total, q));
}));

router.get('/leave/:id', can('hr_leave', 'view'), ah(async (req, res) => {
  const row = await prisma.leaveRequest.findUnique({
    where: { id: intParam(req) },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
  });
  if (!row) throw notFound();
  res.json(row);
}));

router.post('/leave', can('hr_leave', 'create'), ah(async (req, res) => {
  const data = parse(leaveSchema, req.body);
  const row = await prisma.leaveRequest.create({
    data: { ...data, fromDate: new Date(data.fromDate), toDate: new Date(data.toDate) },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
  });
  res.status(201).json(row);
}));

router.put('/leave/:id', can('hr_leave', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const row = await prisma.$transaction(async tx => {
    const before = await revisionSnapshot(tx, 'LeaveRequest', id);
  const existing = await tx.leaveRequest.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status === 'APPROVED') throw badRequest('Approved leave cannot be edited. Cancel and re-apply.');
  const data = parse(leaveSchema, req.body);
  const row = await tx.leaveRequest.update({
    where: { id },
    data: { ...data, fromDate: new Date(data.fromDate), toDate: new Date(data.toDate) },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
  });
    await auditRevision(tx, req.user, 'LeaveRequest', id, before, req.body?.changeReason);
    return row;
  }, { timeout: 30000 });
  res.json(row);
}));

router.delete('/leave/:id', can('hr_leave', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRequest.findUnique({ where: { id } });
    if (!existing) throw notFound('Leave request not found');
    await tx.leaveRequest.delete({ where: { id } });
    await audit(tx, req.user, 'DELETE', 'LeaveRequest', id, {
      employeeId: existing.employeeId, leaveType: existing.leaveType,
      fromDate: existing.fromDate, toDate: existing.toDate, status: existing.status,
    });
  });
  res.json({ ok: true });
}));

router.post('/leave/:id/approve', can('hr_leave', 'approve'), ah(async (req, res) => {
  const id = intParam(req);
  const existing = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status !== 'PENDING') throw badRequest('Only PENDING leave can be approved');
  const row = await prisma.leaveRequest.update({
    where: { id },
    data: { status: 'APPROVED', approvedBy: req.user?.id, approvedAt: new Date(), remarks: String(req.body.remarks ?? '') || null },
  });
  res.json(row);
}));

router.post('/leave/:id/reject', can('hr_leave', 'reject'), ah(async (req, res) => {
  const id = intParam(req);
  const existing = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status !== 'PENDING') throw badRequest('Only PENDING leave can be rejected');
  const row = await prisma.leaveRequest.update({
    where: { id },
    data: { status: 'REJECTED', approvedBy: req.user?.id, approvedAt: new Date(), remarks: String(req.body.remarks ?? '') || null },
  });
  res.json(row);
}));

// ════════════════════════════════════════════════════════════════
// PAYROLL
// ════════════════════════════════════════════════════════════════

router.get('/payroll', can('hr_payroll', 'view'), ah(async (req, res) => {
  const q = listQuery(req);
  const where: Record<string, unknown> = {};
  if (req.query.employeeId) where.employeeId = Number(req.query.employeeId);
  if (req.query.status) where.status = req.query.status;
  const [rows, total] = await Promise.all([
    prisma.payroll.findMany({
      where,
      include: { employee: { select: { id: true, employeeNo: true, fullName: true, department: { select: { name: true } }, designation: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
    prisma.payroll.count({ where }),
  ]);
  res.json(paged(rows, total, q));
}));

router.get('/payroll/:id', can('hr_payroll', 'view'), ah(async (req, res) => {
  const row = await prisma.payroll.findUnique({
    where: { id: intParam(req) },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true, department: { select: { name: true } }, designation: { select: { name: true } } } } },
  });
  if (!row) throw notFound();
  res.json(row);
}));

router.post('/payroll', can('hr_payroll', 'create'), ah(async (req, res) => {
  const data = parse(payrollSchema, req.body);
  const emp = await prisma.employee.findUnique({ where: { id: data.employeeId } });
  if (!emp) throw notFound('Employee not found');
  const gross = num(data.basicSalary) + num(data.housingAllowance) + num(data.transportAllowance) + num(data.otherAllowance) + num(data.overtimePay);
  const net = gross - num(data.deductions);
  const row = await prisma.$transaction(async (tx) => {
    const payrollNo = await nextNumber(tx, 'PAYROLL', { date: new Date(data.periodFrom) });
    return tx.payroll.create({
      data: {
        ...data,
        payrollNo,
        grossSalary: gross,
        netSalary: net,
        periodFrom: new Date(data.periodFrom),
        periodTo: new Date(data.periodTo),
        createdBy: req.user?.id,
      },
      include: { employee: { select: { id: true, employeeNo: true, fullName: true, department: { select: { name: true } }, designation: { select: { name: true } } } } },
    });
  });
  res.status(201).json(row);
}));

router.put('/payroll/:id', can('hr_payroll', 'edit'), ah(async (req, res) => {
  const id = intParam(req);
  const row = await prisma.$transaction(async tx => {
    const before = await revisionSnapshot(tx, 'Payroll', id);
  const existing = await tx.payroll.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status === 'PAID') throw badRequest('Paid payroll cannot be edited.');
  const data = parse(payrollSchema, req.body);
  const gross = num(data.basicSalary) + num(data.housingAllowance) + num(data.transportAllowance) + num(data.otherAllowance) + num(data.overtimePay);
  const net = gross - num(data.deductions);
  const row = await tx.payroll.update({
    where: { id },
    data: {
      ...data,
      grossSalary: gross,
      netSalary: net,
      periodFrom: new Date(data.periodFrom),
      periodTo: new Date(data.periodTo),
    },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true, department: { select: { name: true } }, designation: { select: { name: true } } } } },
  });
    await auditRevision(tx, req.user, 'Payroll', id, before, req.body?.changeReason);
    return row;
  }, { timeout: 30000 });
  res.json(row);
}));

router.post('/payroll/:id/process', can('hr_payroll', 'approve'), ah(async (req, res) => {
  const id = intParam(req);
  const existing = await prisma.payroll.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status !== 'DRAFT') throw badRequest('Only DRAFT payroll can be processed');
  const row = await prisma.payroll.update({
    where: { id },
    data: { status: 'PROCESSED', processedBy: req.user?.id, processedAt: new Date() },
  });
  res.json(row);
}));

router.post('/payroll/:id/pay', can('hr_payroll', 'approve'), ah(async (req, res) => {
  const id = intParam(req);
  const existing = await prisma.payroll.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status !== 'PROCESSED') throw badRequest('Only PROCESSED payroll can be marked as PAID');
  const row = await prisma.payroll.update({ where: { id }, data: { status: 'PAID' } });
  res.json(row);
}));

router.delete('/payroll/:id', can('hr_payroll', 'delete'), ah(async (req, res) => {
  const id = intParam(req);
  const existing = await prisma.payroll.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status !== 'DRAFT') throw badRequest('Only DRAFT payroll can be deleted');
  await prisma.payroll.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── HR Summary (dashboard stats) ──────────────────────────────────────────────

router.get('/summary', can('hr_employees', 'view'), ah(async (_req, res) => {
  const [totalEmployees, activeEmployees, pendingLeave, draftPayroll] = await Promise.all([
    prisma.employee.count(),
    prisma.employee.count({ where: { status: 'ACTIVE' } }),
    prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
    prisma.payroll.count({ where: { status: 'DRAFT' } }),
  ]);
  // Expirying documents in next 30 days
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const expiringDocs = await prisma.employee.count({
    where: {
      status: 'ACTIVE',
      OR: [
        { passportExpiry: { lte: soon } },
        { visaExpiry: { lte: soon } },
        { emiratesExpiry: { lte: soon } },
      ],
    },
  });
  res.json({ totalEmployees, activeEmployees, pendingLeave, draftPayroll, expiringDocs });
}));

export default [{ path: '/hr', router }] satisfies ModuleDef[];
