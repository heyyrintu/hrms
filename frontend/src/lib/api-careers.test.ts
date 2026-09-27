import { publicApi, careersApi, publicOfferApi, preOnboardingApi } from './api-careers';

/**
 * `publicApi` must stay a separate axios instance from the authenticated
 * `api` client: these pages have no session, and must never attach a stray
 * bearer token or trigger the shared 401 redirect.
 */
describe('publicApi', () => {
  it('carries no Authorization header by default', () => {
    expect(publicApi.defaults.headers).not.toHaveProperty('Authorization');
    expect(publicApi.defaults.headers.common ?? {}).not.toHaveProperty('Authorization');
  });

  it('has no request interceptors attaching a token', () => {
    // axios stores interceptors in a private-ish `handlers` array; the point
    // of this test is just that nothing was registered on this instance.
    const handlers = (publicApi.interceptors.request as any).handlers ?? [];
    expect(handlers.filter(Boolean)).toHaveLength(0);
  });
});

describe('careersApi', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('getCareers GETs the tenant careers page', async () => {
    const spy = jest.spyOn(publicApi, 'get').mockResolvedValue({ data: {} } as any);
    await careersApi.getCareers('acme');
    expect(spy).toHaveBeenCalledWith('/public/careers/acme');
  });

  it('encodes the tenant code in the URL', async () => {
    const spy = jest.spyOn(publicApi, 'get').mockResolvedValue({ data: {} } as any);
    await careersApi.getCareers('acme corp');
    expect(spy).toHaveBeenCalledWith('/public/careers/acme%20corp');
  });

  it('getJob GETs the job detail', async () => {
    const spy = jest.spyOn(publicApi, 'get').mockResolvedValue({ data: {} } as any);
    await careersApi.getJob('acme', 'swe-1');
    expect(spy).toHaveBeenCalledWith('/public/careers/acme/jobs/swe-1');
  });

  it('apply POSTs multipart form data with the resume and fields, honeypot included', async () => {
    const spy = jest.spyOn(publicApi, 'post').mockResolvedValue({ data: { message: 'ok' } } as any);
    const resume = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' });

    await careersApi.apply('acme', 'swe-1', { firstName: 'A', lastName: 'B', email: 'a@b.com', website: '' }, resume);

    expect(spy).toHaveBeenCalledWith(
      '/public/careers/acme/jobs/swe-1/apply',
      expect.any(FormData),
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    const form = spy.mock.calls[0][1] as FormData;
    expect(form.get('firstName')).toBe('A');
    expect(form.get('email')).toBe('a@b.com');
    expect(form.get('resume')).toBe(resume);
    expect(form.get('website')).toBe('');
  });

  it('apply omits undefined optional fields from the form', async () => {
    const spy = jest.spyOn(publicApi, 'post').mockResolvedValue({ data: { message: 'ok' } } as any);
    const resume = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' });
    await careersApi.apply('acme', 'swe-1', { firstName: 'A', lastName: 'B', email: 'a@b.com' }, resume);
    const form = spy.mock.calls[0][1] as FormData;
    expect(form.has('phone')).toBe(false);
    expect(form.has('coverLetter')).toBe(false);
  });
});

describe('publicOfferApi', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('get GETs by token', async () => {
    const spy = jest.spyOn(publicApi, 'get').mockResolvedValue({ data: {} } as any);
    await publicOfferApi.get('a'.repeat(64));
    expect(spy).toHaveBeenCalledWith(`/public/offers/${'a'.repeat(64)}`);
  });

  it('accept POSTs the typed name', async () => {
    const spy = jest.spyOn(publicApi, 'post').mockResolvedValue({ data: {} } as any);
    await publicOfferApi.accept('tok', 'Asha Rao');
    expect(spy).toHaveBeenCalledWith('/public/offers/tok/accept', { acceptedName: 'Asha Rao' });
  });

  it('decline POSTs an optional reason', async () => {
    const spy = jest.spyOn(publicApi, 'post').mockResolvedValue({ data: {} } as any);
    await publicOfferApi.decline('tok', 'Took another offer');
    expect(spy).toHaveBeenCalledWith('/public/offers/tok/decline', { reason: 'Took another offer' });
  });
});

describe('preOnboardingApi', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('get GETs by token', async () => {
    const spy = jest.spyOn(publicApi, 'get').mockResolvedValue({ data: {} } as any);
    await preOnboardingApi.get('tok');
    expect(spy).toHaveBeenCalledWith('/public/pre-onboarding/tok');
  });

  it('saveDetails PUTs the details payload', async () => {
    const spy = jest.spyOn(publicApi, 'put').mockResolvedValue({ data: {} } as any);
    await preOnboardingApi.saveDetails('tok', { mobileNumber: '9999999999' });
    expect(spy).toHaveBeenCalledWith('/public/pre-onboarding/tok/details', { mobileNumber: '9999999999' });
  });

  it('uploadDocument POSTs multipart form data to the document key route', async () => {
    const spy = jest.spyOn(publicApi, 'post').mockResolvedValue({ data: {} } as any);
    const file = new File(['%PDF-1.4'], 'id.pdf', { type: 'application/pdf' });
    await preOnboardingApi.uploadDocument('tok', 'photo_id', file);
    expect(spy).toHaveBeenCalledWith(
      '/public/pre-onboarding/tok/documents/photo_id',
      expect.any(FormData),
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    const form = spy.mock.calls[0][1] as FormData;
    expect(form.get('file')).toBe(file);
  });

  it('submit POSTs with no body', async () => {
    const spy = jest.spyOn(publicApi, 'post').mockResolvedValue({ data: {} } as any);
    await preOnboardingApi.submit('tok');
    expect(spy).toHaveBeenCalledWith('/public/pre-onboarding/tok/submit');
  });
});
