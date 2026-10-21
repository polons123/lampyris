package io.github.polons123.lampyris;

import java.util.*;
import java.util.regex.*;

// Разбираем только параметры картинки и звука. Пути, команды и сеть недоступны.
public final class PlayerConfig {
    public final Map<String,String> global = new LinkedHashMap<>();
    public final Map<String,Map<String,String>> profiles = new LinkedHashMap<>();
    public final List<String[]> ignored = new ArrayList<>();
    private static final Map<String,double[]> NUMBERS = new HashMap<>();
    private static final Map<String,Set<String>> ENUMS = new HashMap<>();
    static {
        for(String k:new String[]{"gamma","brightness","contrast","saturation","hue"}) range(k,-100,100);
        range("volume",0,100);range("speed",0.25,4);range("audio-delay",-30,30);range("sub-delay",-120,120);
        range("sub-scale",0.25,4);range("sub-pos",0,150);range("sub-border-size",0,10);range("sub-shadow-offset",0,10);range("sub-margin-y",0,200);range("scale-antiring",0,1);range("cscale-antiring",0,1);
        range("deband-iterations",1,16);range("deband-threshold",0,100);range("deband-range",1,64);range("deband-grain",0,100);
        for(String k:new String[]{"deband","correct-downscaling","linear-downscaling","sigmoid-upscaling","hdr-compute-peak","interpolation","mute"}) choices(k,"yes","no");
        for(String k:new String[]{"scale","cscale","dscale"}) choices(k,"bilinear","bicubic","lanczos","mitchell","spline36","ewa_lanczos","ewa_lanczossharp");
        choices("tone-mapping","auto","clip","mobius","reinhard","hable","bt.2390","gamma","linear");
        choices("video-sync","audio","display-resample","display-resample-vdrop","display-vdrop");
        choices("tscale","oversample","linear","box","triangle");choices("dither-depth","no","auto","8","10","12","16");
        choices("target-peak","auto","100","120","200","400","600","1000");
        choices("sub-border-style","outline-and-shadow","background-box","opaque-box","none");choices("sub-font","sans-serif","Arial","Verdana","Georgia","Courier New");
    }
    private static void range(String k,double a,double b){NUMBERS.put(k,new double[]{a,b});}
    private static void choices(String k,String...v){ENUMS.put(k,new HashSet<>(Arrays.asList(v)));}
    static Set<String> keys(){Set<String> keys=new HashSet<>(NUMBERS.keySet());keys.addAll(ENUMS.keySet());Collections.addAll(keys,"sub-color","sub-back-color","af");return keys;}
    static boolean allowed(String k,String v){
        if(v.length()>160 || v.indexOf('\0')>=0)return false;
        if(NUMBERS.containsKey(k)&&!v.matches("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?"))return false;
        if(NUMBERS.containsKey(k))try{double n=Double.parseDouble(v);double[] r=NUMBERS.get(k);return Double.isFinite(n)&&n>=r[0]&&n<=r[1];}catch(Exception e){return false;}
        if(ENUMS.containsKey(k))return ENUMS.get(k).contains(v);
        if(k.equals("sub-color")||k.equals("sub-back-color"))return v.matches("#[A-Fa-f0-9]{6}([A-Fa-f0-9]{2})?");
        // Один фиксированный фильтр ночного профиля, без произвольных фильтров/файлов.
        return k.equals("af")&&v.equals("acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11");
    }
    public static PlayerConfig parse(String text){
        PlayerConfig out=new PlayerConfig();Map<String,String> section=out.global;
        String[] lines=text.split("\\r?\\n",-1);Pattern entry=Pattern.compile("^(?:--)?([A-Za-z0-9][A-Za-z0-9-]*)\\s*(?:=\\s*(.*))?$");
        for(int i=0;i<lines.length;i++){
            String line=lines[i].trim();if(line.isEmpty()||line.startsWith("#"))continue;
            if(line.startsWith("[")&&line.endsWith("]")){
                String name=line.substring(1,line.length()-1).trim();
                if(name.equals("default"))section=out.global;
                else if(name.matches("[A-Za-z0-9_.-]{1,64}"))section=out.profiles.computeIfAbsent(name,n->new LinkedHashMap<>());
                else{section=null;out.ignored.add(new String[]{""+(i+1),line,"profile"});}continue;
            }
            Matcher m=entry.matcher(line);if(section==null||!m.matches()){out.ignored.add(new String[]{""+(i+1),line,"syntax"});continue;}
            String k=m.group(1).toLowerCase(Locale.ROOT),v=m.group(2);
            if(v==null){v=k.startsWith("no-")?"no":"yes";if(k.startsWith("no-"))k=k.substring(3);}
            v=v.trim();if(v.length()>1&&((v.startsWith("\"")&&v.endsWith("\""))||(v.startsWith("'")&&v.endsWith("'"))))v=v.substring(1,v.length()-1);
            if(allowed(k,v))section.put(k,v);else out.ignored.add(new String[]{""+(i+1),line,"option"});
        }return out;
    }
}
