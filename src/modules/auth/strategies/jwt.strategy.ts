import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

/**
 * JWT Strategy
 * - Validates JWT tokens issued by our backend (NOT Auth0)
 * - JWT represents USER IDENTITY only (userId, email)
 * - Organization context comes ONLY from x-org-id header (OrgGuard)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('database.jwtSecret') || 'default-secret',
    });
  }

  /**
   * Validates JWT payload.
   * Payload structure: { userId, email?, tokenVersion?, iat, exp }
   */
  async validate(payload: any) {
    if (!payload.userId) {
      this.logger.warn('Invalid JWT payload: missing userId');
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      userId: payload.userId,
      email: payload.email ?? null,
    };
  }
}
