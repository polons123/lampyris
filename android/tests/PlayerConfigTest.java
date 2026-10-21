package io.github.polons123.lampyris;
public class PlayerConfigTest {
    private static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        PlayerConfig c=PlayerConfig.parse("gamma=4\n[my-profile]\nscale=bilinear\nno-deband\n[default]\nsub-scale=1.5\n");
        check(c.global.get("gamma").equals("4"));check(c.global.get("sub-scale").equals("1.5"));check(c.profiles.get("my-profile").get("deband").equals("no"));
        c=PlayerConfig.parse("include=/tmp/file\nscript=test\nhttp-proxy=http://localhost\nvo=null\naf=lavfi=[amovie=/etc/file]\ngamma=NaN\nvolume=1000\n[bad name]\ngamma=10\n[good]\ngamma=-8\n");
        check(c.global.isEmpty());check(c.ignored.size()==9);check(c.profiles.get("good").get("gamma").equals("-8"));
        check(!PlayerConfig.allowed("sub-color","#ffffff;run"));check(PlayerConfig.allowed("sub-color","#FFFFFF"));
        c=PlayerConfig.parse("gamma='4'\nno-deband\n[same]\ngamma=1\n[same]\ncontrast=2\n[default]\nbrightness=3\ngamma=\nvolume=0x1p3\n");
        check(c.global.get("gamma").equals("4"));check(c.global.get("deband").equals("no"));check(c.global.get("brightness").equals("3"));
        check(c.profiles.size()==1&&c.profiles.get("same").size()==2);check(c.ignored.size()==2);
        check(!PlayerConfig.allowed("gamma","0x1p3"));check(!PlayerConfig.allowed("speed","NaN"));check(!PlayerConfig.allowed("volume","101"));
        check(PlayerConfig.keys().contains("af")&&PlayerConfig.keys().contains("sub-color"));
        check(PlayerConfig.allowed("sub-border-size","4.5")&&!PlayerConfig.allowed("sub-border-size","99"));
        check(PlayerConfig.allowed("sub-margin-y","90")&&!PlayerConfig.allowed("sub-margin-y","-1"));
        check(PlayerConfig.allowed("sub-font","Courier New")&&!PlayerConfig.allowed("sub-font","/system/fonts/x.ttf"));
        System.out.println("PlayerConfig: valid sections, numeric limits and blocked commands/paths/network OK");
    }
}
