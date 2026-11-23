import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';

export interface ResolvedDelivery {
    zoneId:string;
    zoneName:string;
    fee:number;
}

export interface DeliveryTarget {
    country:string;
    state:string;
    city:string;
}

@Injectable()
export class DeliveryZonesService {
    constructor(private readonly prisma:PrismaService){}

    findAllForVendor(vendorId:string){
        return this.prisma.deliveryZone.findMany({
            where:{vendorId},
            orderBy:[{country:'asc'}, {state:'asc'}, {city:'asc'}],
        });
    }

    async findOne(id:string){
        const zone = await this.prisma.deliveryZone.findUnique({where:{id}});
        if(!zone) throw new NotFoundException(`Delivery zone with ID ${id} not found`);
        return zone;
    }

    private normalise(dto:Partial<CreateDeliveryZoneDto>){
        return {
            ...(dto.country !== undefined?{country:dto.country.toUpperCase()}:{}),
            ...(dto.state !== undefined?{state:dto.state?.trim() || null}:{}),
            ...(dto.city !== undefined?{city:dto.city?.trim() || null}:{}),
        };
    }

    private async assertScopeFree(
        vendorId:string,
        scope:{country:string; state:string|null; city:string|null},
        excludeId?:string,
    ){
        const clash = await this.prisma.deliveryZone.findFirst({
            where:{
                vendorId,
                country:scope.country,
                state:scope.state,
                city:scope.city,
                ...(excludeId?{id:{not:excludeId}}:{}),
            },
        });

        if(clash){
            const where = [scope.city, scope.state, scope.country].filter(Boolean).join(', ');
            throw new ConflictException(`You already have a zone covering ${where}`);
        }
    }

    async create(vendorId:string, createDeliveryZoneDto:CreateDeliveryZoneDto){
        const country = createDeliveryZoneDto.country?.toUpperCase() ?? 'NG';
        const state = createDeliveryZoneDto.state?.trim() || null;
        const city = createDeliveryZoneDto.city?.trim() || null;

        await this.assertScopeFree(vendorId, {country, state, city});

        return this.prisma.deliveryZone.create({
            data:{
                vendorId,
                name:createDeliveryZoneDto.name.trim(),
                country,
                state,
                city,
                fee:createDeliveryZoneDto.fee,
                freeAbove:createDeliveryZoneDto.freeAbove ?? null,
                isActive:createDeliveryZoneDto.isActive ?? true,
            },
        });
    }

    async update(id:string, updateDeliveryZoneDto:UpdateDeliveryZoneDto){
        const zone = await this.findOne(id);
        const normalised = this.normalise(updateDeliveryZoneDto);

        const scope = {
            country:normalised.country ?? zone.country,
            state:normalised.state !== undefined?normalised.state:zone.state,
            city:normalised.city !== undefined?normalised.city:zone.city,
        };
        await this.assertScopeFree(zone.vendorId, scope, id);

        const {name, country, state, city, ...rest} = updateDeliveryZoneDto;
        return this.prisma.deliveryZone.update({
            where:{id},
            data:{
                ...rest,
                ...(name?{name:name.trim()}:{}),
                ...normalised,
            },
        });
    }

    async remove(id:string){
        await this.findOne(id);
        return this.prisma.deliveryZone.delete({where:{id}});
    }

    // Most specific wins: an exact city beats a state-wide row, which beats a
    // country-wide one. Resolved in one query and ranked in code rather than
    // three round trips.
    // `client` lets checkout resolve fees inside its own transaction, so the
    // zones it priced against cannot change between quoting and writing
    async resolve(
        vendorId:string,
        target:DeliveryTarget,
        subtotal:number,
        client:PrismaService|Prisma.TransactionClient = this.prisma,
    ):Promise<ResolvedDelivery|null>{
        const country = target.country.toUpperCase();
        const state = target.state.trim();
        const city = target.city.trim();

        const candidates = await client.deliveryZone.findMany({
            where:{
                vendorId,
                isActive:true,
                country,
                OR:[
                    {state, city},
                    {state, city:null},
                    {state:null, city:null},
                ],
            },
        });

        if(candidates.length === 0) return null;

        const specificity = (zone:{state:string|null; city:string|null}) =>
            zone.city?2:zone.state?1:0;

        const best = candidates.reduce((winner, zone)=>
            specificity(zone) > specificity(winner)?zone:winner,
        );

        const waived = best.freeAbove !== null && subtotal >= best.freeAbove;

        return {
            zoneId:best.id,
            zoneName:best.name,
            fee:waived?0:best.fee,
        };
    }
}
