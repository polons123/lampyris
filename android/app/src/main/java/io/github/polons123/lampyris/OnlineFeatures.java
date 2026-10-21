package io.github.polons123.lampyris;

import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.net.ssl.HttpsURLConnection;

// Сетевые возможности ограничены двумя сервисами, без cookie и пользовательских заголовков.
final class OnlineFeatures {
    private final Set<String> subtitleUrls=Collections.synchronizedSet(new HashSet<>());
    interface Check {boolean accepts(URI uri);}
    private static boolean strem(URI u){String h=u.getHost();return "https".equals(u.getScheme())&&h!=null&&(h.equals("strem.io")||h.endsWith(".strem.io"))&&u.getUserInfo()==null&&(u.getPort()==-1||u.getPort()==443);}
    private static byte[] download(String url,int limit,Check check)throws Exception{
        URI uri=new URI(url);
        for(int redirect=0;redirect<4;redirect++){
            if(!check.accepts(uri))throw new IOException("Address not allowed");
            for(InetAddress a:InetAddress.getAllByName(uri.getHost()))if(NetworkAddressPolicy.blocked(a))throw new IOException("Address not allowed");
            HttpsURLConnection c=(HttpsURLConnection)uri.toURL().openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(4000);c.setReadTimeout(6000);c.setRequestProperty("User-Agent","Lampyris-Android");
            try{
                int status=c.getResponseCode();
                if(status>=300&&status<400){String location=c.getHeaderField("Location");if(location==null)throw new IOException("Redirect");uri=uri.resolve(location);continue;}
                if(status!=200)throw new IOException("HTTP "+status);
                if(c.getContentLengthLong()>limit)throw new IOException("Response too large");
                try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>limit)throw new IOException("Response too large");out.write(buffer,0,n);}return out.toByteArray();
                }
            }finally{c.disconnect();}
        }throw new IOException("Too many redirects");
    }
    String search(String imdb,int season,int episode)throws Exception{
        if(!imdb.matches("tt[0-9]{6,10}")||season<0||season>1000||episode<0||episode>10000)throw new IOException("Invalid episode");
        String path=season>0&&episode>0?"series/"+imdb+":"+season+":"+episode:"movie/"+imdb;
        JSONObject data=new JSONObject(new String(download("https://opensubtitles-v3.strem.io/subtitles/"+path+".json",2_000_000,u->strem(u)&&"opensubtitles-v3.strem.io".equals(u.getHost())),StandardCharsets.UTF_8));
        JSONArray all=data.optJSONArray("subtitles"),safe=new JSONArray();
        if(all!=null)for(int i=0;i<Math.min(all.length(),5000);i++){JSONObject s=all.optJSONObject(i);if(s==null)continue;String url=s.optString("url");try{if(strem(new URI(url))){safe.put(s);if(subtitleUrls.size()>10000)subtitleUrls.clear();subtitleUrls.add(url);}}catch(Exception ignored){}}
        return new JSONObject().put("subtitles",safe).toString();
    }
    String intro(int id,int season,int episode)throws Exception{
        if(id<=0||season<0||season>1000||episode<0||episode>10000)throw new IOException("Invalid episode");
        String q="?tmdb_id="+id+(season>0&&episode>0?"&season="+season+"&episode="+episode:"");
        return new String(download("https://api.theintrodb.org/v3/media"+q,1_000_000,u->"https".equals(u.getScheme())&&"api.theintrodb.org".equals(u.getHost())&&u.getUserInfo()==null&&(u.getPort()==-1||u.getPort()==443)),StandardCharsets.UTF_8);
    }
    byte[] subtitle(String url)throws Exception{if(!subtitleUrls.contains(url))throw new IOException("Search for subtitles first");byte[] data=download(url,3_000_000,OnlineFeatures::strem);if(data.length==0)throw new IOException("Empty subtitle");return data;}
}
