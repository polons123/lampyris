package io.github.polons123.lampyris;
import java.net.*;
public class NetworkAddressPolicyTest {
    private static void check(String ip,boolean blocked)throws Exception{if(NetworkAddressPolicy.blocked(InetAddress.getByName(ip))!=blocked)throw new AssertionError(ip);}
    public static void main(String[] args)throws Exception{
        for(String ip:new String[]{"0.1.2.3","127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.1","169.254.1.1","100.64.0.1","100.127.255.254","::1","fc00::1","fe80::1","::ffff:192.168.1.1","64:ff9b::c0a8:101","64:ff9b::a00:1","2002:c0a8:101::1","::c0a8:101"})check(ip,true);
        for(String ip:new String[]{"8.8.8.8","100.63.255.254","100.128.0.1","2606:4700:4700::1111","::ffff:8.8.8.8","64:ff9b::808:808","2002:808:808::1"})check(ip,false);
        byte[] mapped=new byte[16];mapped[10]=(byte)255;mapped[11]=(byte)255;mapped[12]=100;mapped[13]=64;mapped[15]=1;
        if(!NetworkAddressPolicy.blocked(Inet6Address.getByAddress(null,mapped,-1)))throw new AssertionError("mapped CGNAT");
        System.out.println("Network policy: private, CGNAT, IPv6 and IPv4-mapped addresses OK");
    }
}
