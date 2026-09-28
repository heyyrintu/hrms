import { Test, TestingModule } from '@nestjs/testing';
import { FeedCelebrationsCronService } from './feed-celebrations-cron.service';
import { FeedCelebrationsService } from './feed-celebrations.service';

describe('FeedCelebrationsCronService', () => {
  let cronService: FeedCelebrationsCronService;
  let celebrations: { runForAllTenants: jest.Mock };

  beforeEach(async () => {
    celebrations = { runForAllTenants: jest.fn().mockResolvedValue({ tenants: 2, created: 3, failed: 0 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedCelebrationsCronService,
        { provide: FeedCelebrationsService, useValue: celebrations },
      ],
    }).compile();

    cronService = module.get(FeedCelebrationsCronService);
  });

  it('calls runForAllTenants with the current time', async () => {
    await cronService.handleDailyCelebrations();

    expect(celebrations.runForAllTenants).toHaveBeenCalledWith(expect.any(Date));
  });

  it('does not throw when runForAllTenants rejects', async () => {
    celebrations.runForAllTenants.mockRejectedValue(new Error('boom'));

    await expect(cronService.handleDailyCelebrations()).resolves.toBeUndefined();
  });
});
