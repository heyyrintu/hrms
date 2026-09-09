import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { ReturnsController } from './returns.controller';
import { GeneratedReturnFile, ReturnsService } from './returns.service';
import { mockHrAdmin } from '../../../test/helpers';

function mockResponse() {
  return { setHeader: jest.fn() } as unknown as Response & { setHeader: jest.Mock };
}

const FILE: GeneratedReturnFile = {
  filename: 'pf-ecr-052026.txt',
  contentType: 'text/plain',
  content: '100200300400#~#Asha Rao#~#30000',
  warnings: ['E002 (Bo Singh): skipped from the PF ECR, no UAN on record'],
};

describe('ReturnsController', () => {
  let controller: ReturnsController;
  let service: jest.Mocked<ReturnsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReturnsController],
      providers: [
        {
          provide: ReturnsService,
          useValue: {
            pfEcr: jest.fn().mockResolvedValue(FILE),
            esiReturn: jest.fn().mockResolvedValue(FILE),
            professionalTaxChallan: jest.fn().mockResolvedValue(FILE),
            form24Q: jest.fn().mockResolvedValue(FILE),
            bankTransferFile: jest.fn().mockResolvedValue(FILE),
          },
        },
      ],
    }).compile();

    controller = module.get(ReturnsController);
    service = module.get(ReturnsService);
  });

  it("passes the caller's own tenant, never one from the request", async () => {
    const res = mockResponse();

    await controller.pfEcr(mockHrAdmin, 'run-1', res);

    expect(service.pfEcr).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'run-1');
  });

  it('streams the file content as an attachment by default', async () => {
    const res = mockResponse();

    const body = await controller.pfEcr(mockHrAdmin, 'run-1', res);

    expect(body).toBe(FILE.content);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="pf-ecr-052026.txt"',
    );
  });

  it('tells a download-only client that somebody was left out', async () => {
    const res = mockResponse();

    await controller.pfEcr(mockHrAdmin, 'run-1', res);

    expect(res.setHeader).toHaveBeenCalledWith('X-Return-Warning-Count', '1');
  });

  it('returns the warnings alongside the content when asked for JSON', async () => {
    const res = mockResponse();

    const body = await controller.pfEcr(mockHrAdmin, 'run-1', res, 'false');

    expect(body).toEqual(FILE);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('wires each return to its own service method', async () => {
    const res = mockResponse();

    await controller.esiReturn(mockHrAdmin, 'run-1', res);
    await controller.professionalTaxChallan(mockHrAdmin, 'run-1', res);
    await controller.form24Q(mockHrAdmin, 'run-1', res);
    await controller.bankTransferFile(mockHrAdmin, 'run-1', res);

    expect(service.esiReturn).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'run-1');
    expect(service.professionalTaxChallan).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'run-1');
    expect(service.form24Q).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'run-1');
    expect(service.bankTransferFile).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'run-1');
  });
});
