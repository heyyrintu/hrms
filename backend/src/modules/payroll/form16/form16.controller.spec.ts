import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Form16Controller } from './form16.controller';
import { Form16Service } from './form16.service';
import { Form16PdfService } from './form16-pdf.service';
import { mockEmployee, mockHrAdmin } from '../../../test/helpers';

describe('Form16Controller', () => {
  let controller: Form16Controller;
  let form16Service: { computePartB: jest.Mock; getQuarterlyTdsSummary: jest.Mock };
  let pdfService: { generatePartBPdf: jest.Mock };

  const partB = { employee: { employeeCode: 'E001' } };

  beforeEach(async () => {
    form16Service = {
      computePartB: jest.fn().mockResolvedValue(partB),
      getQuarterlyTdsSummary: jest.fn().mockResolvedValue({ quarters: [] }),
    };
    pdfService = {
      generatePartBPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3 stub')),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [Form16Controller],
      providers: [
        { provide: Form16Service, useValue: form16Service },
        { provide: Form16PdfService, useValue: pdfService },
      ],
    }).compile();

    controller = module.get<Form16Controller>(Form16Controller);
  });

  it('passes the caller through to the service so it can authorise', async () => {
    await controller.getPartB(mockHrAdmin, 'emp-1', '2025');

    expect(form16Service.computePartB).toHaveBeenCalledWith(
      mockHrAdmin.tenantId,
      'emp-1',
      2025,
      mockHrAdmin,
    );
  });

  it('binds the "my" routes to the caller\'s own employee id', async () => {
    await controller.getMyPartB(mockEmployee, '2025');

    expect(form16Service.computePartB).toHaveBeenCalledWith(
      mockEmployee.tenantId,
      mockEmployee.employeeId,
      2025,
      mockEmployee,
    );
  });

  it('does not swallow the service refusal', async () => {
    form16Service.computePartB.mockRejectedValue(new ForbiddenException());

    await expect(controller.getPartB(mockEmployee, 'emp-other', '2025')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('names the download so it cannot be mistaken for the certificate', async () => {
    const res = {
      setHeader: jest.fn(),
      end: jest.fn(),
    } as never;

    await controller.downloadPdf(mockHrAdmin, 'emp-1', '2025', res);

    const headers = (res as unknown as { setHeader: jest.Mock }).setHeader.mock.calls;
    const disposition = headers.find((c: string[]) => c[0] === 'Content-Disposition')?.[1];

    expect(disposition).toContain('form16-part-b-E001-2025-26.pdf');
    expect(headers).toContainEqual(['Content-Type', 'application/pdf']);
  });

  it('authorises before rendering: no PDF is built for a refused request', async () => {
    form16Service.computePartB.mockRejectedValue(new ForbiddenException());
    const res = { setHeader: jest.fn(), end: jest.fn() } as never;

    await expect(
      controller.downloadPdf(mockEmployee, 'emp-other', '2025', res),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pdfService.generatePartBPdf).not.toHaveBeenCalled();
  });

  it('forwards the quarterly summary request with the caller attached', async () => {
    await controller.getQuarters(mockHrAdmin, 'emp-1', '2025');

    expect(form16Service.getQuarterlyTdsSummary).toHaveBeenCalledWith(
      mockHrAdmin.tenantId,
      'emp-1',
      2025,
      mockHrAdmin,
    );
  });
});
