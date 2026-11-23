import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
    constructor(private readonly prisma:PrismaService){}

    findAllForUser(userId:string){
        return this.prisma.address.findMany({
            where:{userId},
            orderBy:[{isDefault:'desc'}, {createdAt:'desc'}],
        });
    }

    async findOneForUser(userId:string, id:string){
        const address = await this.prisma.address.findFirst({where:{id, userId}});
        if(!address) throw new NotFoundException(`Address with ID ${id} not found`);
        return address;
    }

    async create(userId:string, createAddressDto:CreateAddressDto){
        const existing = await this.prisma.address.count({where:{userId}});
        const isDefault = createAddressDto.isDefault ?? existing === 0;

        return this.prisma.$transaction(async (tx)=>{
            if(isDefault){
                await tx.address.updateMany({where:{userId}, data:{isDefault:false}});
            }

            return tx.address.create({
                data:{
                    ...createAddressDto,
                    country:createAddressDto.country?.toUpperCase() ?? 'NG',
                    isDefault,
                    userId,
                },
            });
        });
    }

    async update(userId:string, id:string, updateAddressDto:UpdateAddressDto){
        await this.findOneForUser(userId, id);

        return this.prisma.$transaction(async (tx)=>{
            if(updateAddressDto.isDefault === true){
                await tx.address.updateMany({where:{userId}, data:{isDefault:false}});
            }

            return tx.address.update({
                where:{id},
                data:{
                    ...updateAddressDto,
                    ...(updateAddressDto.country
                        ?{country:updateAddressDto.country.toUpperCase()}
                        :{}),
                },
            });
        });
    }

    async remove(userId:string, id:string){
        const address = await this.findOneForUser(userId, id);

        return this.prisma.$transaction(async (tx)=>{
            const deleted = await tx.address.delete({where:{id}});
            if(address.isDefault){
                const next = await tx.address.findFirst({
                    where:{userId},
                    orderBy:{createdAt:'desc'},
                });
                if(next){
                    await tx.address.update({where:{id:next.id}, data:{isDefault:true}});
                }
            }
            return deleted;
        });
    }
}
