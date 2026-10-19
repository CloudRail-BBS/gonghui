module.exports = {
  guilds: [
  {slug:"beichen", name:"北辰", badge:"北", color:"#E8B44B", level:7, points:2388, wr:78.2, members:40, trend:2, recruit:false, server:"霜原服", founded:"2024-03-11", online:17,
   tags:["老牌强队","卫冕冠军"], intro:"北辰成立于 2024 年春，专注生存与团队竞技。我们不追求人数，只追求每一场都能站在最后。训练日固定为每周三、周六晚八点，缺勤两次自动转为见习。"},
  {slug:"shuangxu", name:"霜序", badge:"霜", color:"#2DD4BF", level:7, points:2164, wr:71.4, members:32, trend:1, recruit:true, server:"霜原服", founded:"2025-11-02", online:12,
   tags:["活跃","建筑向"], intro:"霜序是一群喜欢在雪原上盖房子的玩家组成的公会。我们打竞技，但更在意主城那面墙是不是好看。每周日举办公会内部建筑赛，冠军作品留在公会展馆。"},
  {slug:"redstone", name:"红石工坊", badge:"红", color:"#C9684A", level:6, points:1907, wr:64.9, members:28, trend:-1, recruit:true, server:"岚岛服", founded:"2024-08-19", online:9,
   tags:["红石","自动化"], intro:"一群红石电路爱好者。公会仓库对成员完全开放，代价是你要留下你的电路图。"},
  {slug:"endwalker", name:"末地行者", badge:"末", color:"#6B7A8F", level:6, points:1802, wr:61.1, members:24, trend:0, recruit:false, server:"橡木服", founded:"2024-05-06", online:7,
   tags:["探险","末地"], intro:"专注末地与下界探索，拥有全服最完整的要塞坐标库。"},
  {slug:"oakbay", name:"橡木湾", badge:"橡", color:"#8A6E4B", level:5, points:1655, wr:58.3, members:21, trend:3, recruit:true, server:"橡木服", founded:"2025-02-14", online:8,
   tags:["休闲","建筑"], intro:"海边小镇风格的休闲公会，欢迎所有想慢慢玩的人。"},
  {slug:"starglow", name:"星辉", badge:"星", color:"#7A5C8F", level:5, points:1540, wr:55.0, members:19, trend:-2, recruit:true, server:"星海服", founded:"2025-04-01", online:5,
   tags:["新锐"], intro:"成立于第 2 赛季的新公会，进步很快，正在寻找稳定的 PVP 成员。"},
  {slug:"forge", name:"熔炉", badge:"熔", color:"#B4552F", level:5, points:1482, wr:52.6, members:22, trend:0, recruit:false, server:"岚岛服", founded:"2024-11-23", online:6,
   tags:["模组","工业"], intro:"岚岛服的工业公会，机械动力与格雷科技的老手聚集地。"},
  {slug:"creeper", name:"苦力怕之家", badge:"苦", color:"#5E8C4A", level:4, points:1398, wr:50.0, members:18, trend:1, recruit:true, server:"橡木服", founded:"2025-06-08", online:4,
   tags:["休闲"], intro:"名字很危险，人很温和。以农场和刷怪塔建设为主。"},
  {slug:"deepguard", name:"深海守卫", badge:"深", color:"#3E6F8E", level:4, points:1310, wr:48.7, members:20, trend:-1, recruit:true, server:"星海服", founded:"2025-03-17", online:5,
   tags:["空岛","防守"], intro:"星海服的空岛玩法公会，擅长以少打多。"},
  {slug:"birch", name:"白桦林", badge:"桦", color:"#9AA5A0", level:4, points:1240, wr:46.2, members:16, trend:0, recruit:false, server:"橡木服", founded:"2025-01-30", online:3,
   tags:["建筑"], intro:"安静的建造公会，主城由成员共同设计。"},
  {slug:"dune", name:"沙丘商会", badge:"沙", color:"#B99A5B", level:3, points:1155, wr:44.4, members:14, trend:2, recruit:true, server:"岚岛服", founded:"2025-07-21", online:4,
   tags:["交易","新会"], intro:"以玩家交易和补给为主营业务，欢迎商人加入。"},
  {slug:"mush", name:"蘑菇岛", badge:"菇", color:"#A2547A", level:3, points:1080, wr:41.7, members:12, trend:-3, recruit:true, server:"星海服", founded:"2025-08-05", online:2,
   tags:["新会"], intro:"刚成立三个月的小公会，什么位置都缺。"}
],
  tournaments: [
  {id:"s3", name:"群系争锋 · 八强淘汰赛", status:"live", format:"单败淘汰 · BO3", teams:8, done:4, prize:"¥3,000 + 主城雕像", next:"半决赛 10-24 20:00", cap:8, signed:8},
  {id:"winter", name:"冬季邀请赛 2026", status:"open", format:"邀请制 · BO5", teams:6, done:0, prize:"¥5,000 + 专属称号", next:"报名截止 11-10", cap:8, signed:3},
  {id:"guildcup", name:"公会自办赛 · 橡木湾杯", status:"open", format:"双败淘汰 · BO1", teams:12, done:0, prize:"点券 5,000 + 纪念徽章", next:"报名截止 11-02", cap:16, signed:9},
  {id:"s2", name:"第 2 赛季 总决赛", status:"done", format:"单败淘汰 · BO3", teams:8, done:8, prize:"¥3,000", next:"已结束 · 冠军 北辰", cap:8, signed:8}
],
  bracket: [
  {name:"八强", round:"ROUND 1", ms:[
    {id:"r1m1", a:"北辰", b:"蘑菇岛", sa:2, sb:0, done:true},
    {id:"r1m2", a:"霜序", b:"沙丘商会", sa:2, sb:1, done:true},
    {id:"r1m3", a:"红石工坊", b:"白桦林", sa:2, sb:0, done:true},
    {id:"r1m4", a:"末地行者", b:"深海守卫", sa:1, sb:2, done:true}
  ]},
  {name:"半决赛", round:"ROUND 2", ms:[
    {id:"r2m1", a:"北辰", b:"深海守卫", sa:null, sb:null, done:false, time:"10-24 20:00"},
    {id:"r2m2", a:"霜序", b:"红石工坊", sa:null, sb:null, done:false, time:"10-25 20:00"}
  ]},
  {name:"决赛", round:"FINAL", ms:[
    {id:"r3m1", a:"待定", b:"待定", sa:null, sb:null, done:false, time:"10-31 20:00"}
  ]}
]
};
