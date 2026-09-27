import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PublicCareersController } from './public-careers.controller';
import { PublicCareersService } from './public-careers.service';
import { PublicPreOnboardingController } from './public-pre-onboarding.controller';
import { PreOnboardingService } from './pre-onboarding.service';
import { MAX_UPLOAD_SIZE_BYTES } from './upload-guards';

/**
 * The two unauthenticated upload routes must stop multer at the size limit
 * while streaming, instead of buffering a multi-GB body into memory and only
 * then letting assertResume / assertDocument reject it. Exercised over real
 * HTTP so the FileInterceptor options (not just the service guard) are tested.
 */
describe('public recruitment routes over HTTP: upload limits and throttling', () => {
  let app: INestApplication;
  let baseUrl: string;
  const careers = {
    getCareers: jest.fn().mockResolvedValue({}),
    getJob: jest.fn().mockResolvedValue({}),
    apply: jest.fn().mockResolvedValue({ message: 'ok' }),
  };
  const preOnboarding = {
    getPublic: jest.fn(),
    saveDetailsPublic: jest.fn(),
    uploadDocumentPublic: jest.fn().mockResolvedValue({ ok: true }),
    submitPublic: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }])],
      controllers: [PublicCareersController, PublicPreOnboardingController],
      providers: [
        { provide: PublicCareersService, useValue: careers },
        { provide: PreOnboardingService, useValue: preOnboarding },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  function pdf(size: number): Blob {
    const bytes = new Uint8Array(size);
    bytes.set(Buffer.from('%PDF-1.4'));
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function applyForm(resume: Blob, extra: Record<string, string> = {}): FormData {
    const form = new FormData();
    form.append('firstName', 'Asha');
    form.append('lastName', 'Rao');
    form.append('email', 'asha@example.com');
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    form.append('resume', resume, 'resume.pdf');
    return form;
  }

  it('careers apply: 413 for a resume over the limit, before the service runs', async () => {
    const res = await fetch(`${baseUrl}/public/careers/acme/jobs/swe/apply`, {
      method: 'POST',
      body: applyForm(pdf(MAX_UPLOAD_SIZE_BYTES + 1)),
    });
    expect(res.status).toBe(413);
    expect(careers.apply).not.toHaveBeenCalled();
  });

  it('careers apply: a resume within the limit reaches the service', async () => {
    const res = await fetch(`${baseUrl}/public/careers/acme/jobs/swe/apply`, {
      method: 'POST',
      body: applyForm(pdf(1024)),
    });
    expect(res.status).toBe(201);
    expect(careers.apply).toHaveBeenCalledWith(
      'acme',
      'swe',
      expect.objectContaining({ firstName: 'Asha' }),
      expect.objectContaining({ size: 1024, fieldname: 'resume' }),
    );
  });

  it('careers apply: 400 for a second file part', async () => {
    const form = applyForm(pdf(1024));
    form.append('resume', pdf(1024), 'second.pdf');
    const res = await fetch(`${baseUrl}/public/careers/acme/jobs/swe/apply`, { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect(careers.apply).not.toHaveBeenCalled();
  });

  it('careers apply: 400 for an oversized text field', async () => {
    const res = await fetch(`${baseUrl}/public/careers/acme/jobs/swe/apply`, {
      method: 'POST',
      body: applyForm(pdf(1024), { coverLetter: 'x'.repeat(100_000) }),
    });
    expect(res.status).toBe(400);
    expect(careers.apply).not.toHaveBeenCalled();
  });

  it('careers apply: 400 for too many fields', async () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < 40; i++) extra[`f${i}`] = 'x';
    const res = await fetch(`${baseUrl}/public/careers/acme/jobs/swe/apply`, {
      method: 'POST',
      body: applyForm(pdf(1024), extra),
    });
    expect(res.status).toBe(400);
    expect(careers.apply).not.toHaveBeenCalled();
  });

  it.each([
    ['careers page', '/public/careers/throttle-a'],
    ['job listing', '/public/careers/throttle-b/jobs/swe'],
  ])('throttles the public %s GET at 60 per minute', async (_label, path) => {
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
    }
    const limited = await fetch(`${baseUrl}${path}`);
    expect(limited.status).toBe(429);
  });

  it('pre-onboarding document: 413 over the limit, 201 within it', async () => {
    const big = new FormData();
    big.append('file', pdf(MAX_UPLOAD_SIZE_BYTES + 1), 'id.pdf');
    const tooBig = await fetch(`${baseUrl}/public/pre-onboarding/tok/documents/photo_id`, {
      method: 'POST',
      body: big,
    });
    expect(tooBig.status).toBe(413);
    expect(preOnboarding.uploadDocumentPublic).not.toHaveBeenCalled();

    const ok = new FormData();
    ok.append('file', pdf(2048), 'id.pdf');
    const res = await fetch(`${baseUrl}/public/pre-onboarding/tok/documents/photo_id`, {
      method: 'POST',
      body: ok,
    });
    expect(res.status).toBe(201);
    expect(preOnboarding.uploadDocumentPublic).toHaveBeenCalledWith(
      'tok',
      'photo_id',
      expect.objectContaining({ size: 2048, fieldname: 'file' }),
    );
  });
});
