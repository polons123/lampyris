package io.github.polons123.lampyris;

import java.net.*;
import java.util.Arrays;

// Дополнительная защита загрузок с разрешённых публичных хостов.
final class NetworkAddressPolicy {
    static boolean blocked(InetAddress address){
        byte[] bytes=address.getAddress();
        if(bytes.length==16){
            boolean mapped=true;
            for(int i=0;i<10;i++)mapped &= bytes[i]==0;
            mapped &= bytes[10]==(byte)255&&bytes[11]==(byte)255;
            if(mapped)try{return blocked(InetAddress.getByAddress(Arrays.copyOfRange(bytes,12,16)));}catch(UnknownHostException e){return true;}
            // NAT64 (64:ff9b::/96) и IPv4-совместимые (::/96) несут IPv4 в последних четырёх байтах, 6to4 (2002::/16) — во 2–5-м.
            boolean nat64=bytes[0]==0&&bytes[1]==0x64&&(bytes[2]&255)==0xff&&(bytes[3]&255)==0x9b;
            for(int i=4;i<12&&nat64;i++)nat64&=bytes[i]==0;
            boolean compatible=true;for(int i=0;i<12;i++)compatible&=bytes[i]==0;
            if(nat64||compatible&&(bytes[12]|bytes[13]|bytes[14])!=0)try{return blocked(InetAddress.getByAddress(Arrays.copyOfRange(bytes,12,16)));}catch(UnknownHostException e){return true;}
            if(bytes[0]==0x20&&bytes[1]==0x02)try{return blocked(InetAddress.getByAddress(Arrays.copyOfRange(bytes,2,6)));}catch(UnknownHostException e){return true;}
            if((bytes[0]&0xfe)==0xfc)return true;
        }
        if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isSiteLocalAddress()||address.isLinkLocalAddress()||address.isMulticastAddress())return true;
        return bytes.length==4&&((bytes[0]&255)==0||((bytes[0]&255)==100&&((bytes[1]&255)&0xc0)==0x40));
    }
}
