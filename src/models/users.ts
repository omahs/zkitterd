import {BIGINT, QueryTypes, Sequelize, STRING} from "sequelize";
import userMetaSeq from "./userMeta";
import {Mutex} from "async-mutex";

export type UserModel = {
    ens: string;
    pubkey: string;
    joinedAt: number;
    name: string;
    bio: string;
    coverImage: string;
    profileImage: string;
    website: string;
    meta: {
        blockedCount: number;
        blockingCount: number;
        followerCount: number;
        followingCount: number;
        followed: string | null;
        blocked: string | null;
    }
};

const mutex = new Mutex();

const users = (sequelize: Sequelize) => {
    const model = sequelize.define('users', {
        name: {
            type: STRING,
            allowNull: false,
            validate: {
                notEmpty: true,
            },
            primaryKey: true,
            unique: true,
        },
        pubkey: {
            type: STRING,
            allowNull: false,
            validate: {
                notEmpty: true,
            },
        },
        joinedAt: {
            type: BIGINT,
        },
    }, {
        indexes: [
            { fields: ['name'] },
            { fields: ['pubkey'] },
        ]
    });

    const findOneByName = async (name: string, context = ''): Promise<UserModel|null> => {
        const values = await sequelize.query(`
            ${userSelectQuery}
            WHERE u.name = :name
        `, {
            type: QueryTypes.SELECT,
            replacements: {
                context: context || '',
                name: name,
            },
        });

        const [user] = inflateValuesToUserJSON(values);

        return user || null;
    }

    const findOneByPubkey = async (pubkey: string): Promise<UserModel|null> => {
        let result = await model.findOne({
            where: {
                pubkey,
            },
        });

        if (!result) return null;

        const json = result.toJSON() as UserModel;

        return json;
    }

    const readAll = async (context = '', offset = 0, limit = 20): Promise<UserModel[]> => {
        const values = await sequelize.query(`
            ${userSelectQuery}
            ORDER BY u."joinedAt" ASC
            LIMIT :limit OFFSET :offset
        `, {
            type: QueryTypes.SELECT,
            replacements: {
                context: context || '',
                limit,
                offset,
            },
        });

        return inflateValuesToUserJSON(values);
    }

    const updateOrCreateUser = async (user: UserModel) => {
        return mutex.runExclusive(async () => {
            const result = await model.findOne({
                where: {
                    name: user.name,
                }
            });

            if (result) {
                const json = result.toJSON() as UserModel;
                if (user.joinedAt > json.joinedAt) {
                    return result.update(user);
                }
            }

            return model.create(user);
        });
    }

    const ensureUser = async (name: string) => {
        return mutex.runExclusive(async () => {
            const result = await model.findOne({
                where: {
                    name: name,
                }
            });

            if (!result) {
                return model.create({
                    name,
                    pubkey: '',
                    joined: 0,
                });
            }

        });
    }

    return {
        model,
        ensureUser,
        findOneByName,
        findOneByPubkey,
        readAll,
        updateOrCreateUser,
    };
}

export default users;

const userSelectQuery = `
    SELECT  
        u.name,
        u.pubkey,
        u."joinedAt",
        umt."followerCount",
        umt."followingCount",
        umt."blockedCount",
        umt."blockingCount",
        f."messageId" as followed,
        b."messageId" as blocked,
        bio.value as bio,
        name.value as nickname,
        "profileImage".value as "profileImage",
        "coverImage".value as "coverImage",
        website.value as website
    FROM users u
    LEFT JOIN usermeta umt ON umt.name = u.name
    LEFT JOIN connections f ON f.subtype = 'FOLLOW' AND f.creator = :context AND f.name = u.name
    LEFT JOIN connections b ON f.subtype = 'BLOCK' AND f.creator = :context AND f.name = u.name
    LEFT JOIN profiles bio ON bio."messageId" = (SELECT "messageId" FROM profiles WHERE creator = u.name AND subtype = 'BIO' ORDER BY "createdAt" DESC LIMIT 1)
    LEFT JOIN profiles name ON name."messageId" = (SELECT "messageId" FROM profiles WHERE creator = u.name AND subtype = 'NAME' ORDER BY "createdAt" DESC LIMIT 1)
    LEFT JOIN profiles "profileImage" ON "profileImage"."messageId" = (SELECT "messageId" FROM profiles WHERE creator = u.name AND subtype = 'PROFILE_IMAGE' ORDER BY "createdAt" DESC LIMIT 1)
    LEFT JOIN profiles "coverImage" ON "coverImage"."messageId" = (SELECT "messageId" FROM profiles WHERE creator = u.name AND subtype = 'COVER_IMAGE' ORDER BY "createdAt" DESC LIMIT 1)
    LEFT JOIN profiles website ON website."messageId" = (SELECT "messageId" FROM profiles WHERE creator = u.name AND subtype = 'WEBSITE' ORDER BY "createdAt" DESC LIMIT 1)
`;

function inflateValuesToUserJSON(values: any[]): UserModel[] {
    return values.map(value => ({
        ens: value.name,
        pubkey: value.pubkey,
        joinedAt: value.joinedAt,
        name: value.nickname || '',
        bio: value.bio || '',
        profileImage: value.profileImage || '',
        coverImage: value.coverImage || '',
        website: value.website || '',
        meta: {
            blockedCount: value.blockedCount || 0,
            blockingCount: value.blockingCount || 0,
            followerCount: value.followerCount || 0,
            followingCount: value.followingCount || 0,
            followed: value.followed,
            blocked: value.blocked,
        },
    }));
}